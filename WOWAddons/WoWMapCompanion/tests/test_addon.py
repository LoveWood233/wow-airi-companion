"""Execute the actual addon Lua in Lua 5.1 with a minimal WoW API harness.

Install test-only runtime: python -m pip install --target tests/.deps lupa
Run: python -m unittest discover -s tests -v
"""
from __future__ import annotations

import binascii
import json
import pathlib
import struct
import sys
import unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / ".deps"))
from lupa.lua51 import LuaRuntime

ROOT = HERE.parent
MOCK = b'''
Objects, Frames, Timers, Tickers, Messages = {}, {}, {}, {}, {}
Screen = {width=2560, height=1600}
Model = {level=29, name="Adventurer", realm="Realm", class="MAGE", spec=64, map=84, zone="Stormwind", dead=false, combat=false}
Secret = setmetatable({}, {__tostring=function() error("secret converted") end})
function issecretvalue(v) return rawequal(v, Secret) end
local methods = {}
function methods:CreateTexture()
  local texture=setmetatable({parent=self}, {__index=methods})
  self.textures[#self.textures+1]=texture
  return texture
end
function methods:CreateFontString() return setmetatable({}, {__index=methods}) end
function methods:SetColorTexture(r,g,b,a)
  self.color={r,g,b,a}; self.writes=(rawget(self,"writes") or 0)+1
  if NDuiPixelSnapHook then self:SetSnapToPixelGrid(false); self:SetTexelSnappingBias(0) end
end
function methods:SetScript(name, callback) self.scripts[name]=callback end
function methods:RegisterEvent(event) self.events[event]=true end
function methods:SetText(text) self.text=text end
function methods:SetShown(value) self.shown=value end
function methods:SetScale(value) self.scale=value end
function methods:SetRoundLayoutToNearestPixel(value) self.roundLayout=value end
function methods:SetSnapToPixelGrid(value) self.snapToPixelGrid=value end
function methods:SetTexelSnappingBias(value) self.texelSnappingBias=value end
function methods:SetSize(w,h) self.width=w; self.height=h; self.sizeWrites=(rawget(self,"sizeWrites") or 0)+1 end
function methods:SetPoint(...) self.point={...} end
function methods:GetStringHeight() return 16 end
function methods:GetEffectiveScale()
  local parent=rawget(self,"parent")
  return (rawget(self,"scale") or 1) * (parent and parent:GetEffectiveScale() or 1)
end
setmetatable(methods, {__index=function() return function() end end})
function CreateFrame(kind, name, parent)
  local obj=setmetatable({events={},scripts={},textures={},name=name,parent=parent}, {__index=methods})
  Frames[#Frames+1]=obj
  if name then Objects[name]=obj end
  return obj
end
UIParent=CreateFrame("Frame", "UIParent")
UIParent.scale=0.7
function GetPhysicalScreenSize() return Screen.width, Screen.height end
PixelUtil={GetPixelToUIUnitFactor=function() return 768 / Screen.height end}
SlashCmdList={}
function print(message) Messages[#Messages+1]=message end
function GetServerTime() return 1700000000 end
function time() return 1700000000 end
function GetTime() return 12.5 end
function UnitGUID() return "Player-1-00000001" end
function UnitName() return Model.name end
function UnitClass() return "Mage", Model.class end
function UnitLevel() return Model.level end
function GetRealmName() return Model.realm end
function GetSpecialization() return 1 end
function GetSpecializationInfo() return Model.spec end
function GetRealZoneText() return Model.zone end
function GetZoneText() return Model.zone end
function UnitIsDeadOrGhost() return Model.dead end
function InCombatLockdown() return Model.combat end
C_Map={GetBestMapForUnit=function() return Model.map end, GetMapInfo=function() return {name=Model.zone} end}
C_Timer={
  NewTimer=function(delay, callback) local t={delay=delay,callback=callback,Cancel=function(self) self.cancelled=true end}; Timers[#Timers+1]=t; return t end,
  NewTicker=function(delay, callback) local t={callback=callback}; Tickers[#Tickers+1]=t; return t end
}
function Fire(event, ...)
  for _, frame in ipairs(Frames) do if frame.events[event] then frame.scripts.OnEvent(frame,event,...) end end
end
function Heartbeat() for _, ticker in ipairs(Tickers) do ticker.callback() end end
function RetryTimers() for _, timer in ipairs(Timers) do if not timer.cancelled then timer.callback() end end end
'''


class AddonTest(unittest.TestCase):
    def setUp(self):
        self.lua = LuaRuntime(encoding=None, unpack_returned_tuples=True)
        self.lua.execute(MOCK)
        self.ns = self.lua.table()
        self.load = self.lua.eval(b"function(source, name, ns) local f, err = loadstring(source); assert(f, err); return f(name, ns) end")
        for name in ("Protocol.lua", "Telemetry.lua", "WoWMapCompanion.lua"):
            self.load((ROOT / name).read_bytes(), b"WoWMapCompanion", self.ns)
        self.lua.globals().Fire(b"ADDON_LOADED", b"WoWMapCompanion")
        self.lua.globals().Fire(b"PLAYER_ENTERING_WORLD")

    def snapshot(self):
        return json.loads(self.lua.globals().WoWMapCompanionDB[b"snapshotJSON"])

    def test_crc_and_bit_order_match_python(self):
        protocol = self.ns[b"Protocol"]
        self.assertEqual(protocol[b"SelfTest"]()[0], True)
        self.assertEqual(protocol[b"CRC16"](b"123456789"), binascii.crc_hqx(b"123456789", 0xFFFF))
        frame, payload, _ = protocol[b"Encode"](self.lua.globals().WoWMapCompanionDB[b"snapshot"])
        self.assertEqual(len(frame), 512)
        self.assertEqual(frame[:4], b"WCP1")
        length, crc = struct.unpack("<HH", frame[4:8])
        self.assertEqual(payload, frame[8:8 + length])
        self.assertEqual(crc, binascii.crc_hqx(payload, 0xFFFF))
        reconstructed = bytes(sum(protocol[b"Bit"](frame, byte * 8 + bit) << (7 - bit) for bit in range(8)) for byte in range(512))
        self.assertEqual(reconstructed, frame)

    def test_level_event_wins_over_temporarily_stale_unit_level(self):
        before = self.snapshot()
        self.lua.globals().Fire(b"PLAYER_LEVEL_UP", 30)
        after = self.snapshot()
        self.assertEqual(after["level"], 30)
        self.assertEqual(after["seq"], before["seq"] + 1)
        self.lua.globals().RetryTimers()
        self.assertEqual(self.snapshot()["level"], 30)
        self.assertEqual(self.snapshot()["seq"], after["seq"])

    def test_heartbeat_does_not_create_business_events(self):
        before = self.snapshot()
        self.lua.globals().Heartbeat()
        after = self.snapshot()
        self.assertEqual(after["tick"], before["tick"] + 1)
        self.assertEqual(after["seq"], before["seq"])

    def test_current_namespaced_specialization_api(self):
        self.lua.execute(b"C_SpecializationInfo={GetSpecialization=GetSpecialization,GetSpecializationInfo=GetSpecializationInfo}; GetSpecialization=nil; GetSpecializationInfo=nil; Model.spec=62")
        self.lua.globals().Fire(b"PLAYER_SPECIALIZATION_CHANGED", b"player")
        self.assertEqual(self.snapshot()["spec"], 62)

    def test_combat_death_zone_and_logout(self):
        g = self.lua.globals()
        g.Fire(b"PLAYER_REGEN_DISABLED")
        self.assertTrue(self.snapshot()["combat"])
        g.Fire(b"PLAYER_REGEN_ENABLED")
        self.assertFalse(self.snapshot()["combat"])
        g.Fire(b"PLAYER_DEAD")
        self.assertTrue(self.snapshot()["dead"])
        g.Fire(b"PLAYER_UNGHOST")
        self.assertFalse(self.snapshot()["dead"])
        g.Model[b"zone"] = "艾尔文森林".encode()
        g.Model[b"map"] = 37
        g.Fire(b"ZONE_CHANGED_NEW_AREA")
        self.assertEqual(self.snapshot()["zone"], "艾尔文森林")
        g.Fire(b"PLAYER_LEAVING_WORLD")
        self.assertFalse(self.snapshot()["online"])
        g.Fire(b"PLAYER_ENTERING_WORLD")
        self.assertTrue(self.snapshot()["online"])

    def test_secret_values_never_exported_or_converted(self):
        g = self.lua.globals()
        before = self.snapshot()
        g.Model[b"name"] = g.Secret
        g.Model[b"level"] = g.Secret
        g.Model[b"class"] = g.Secret
        g.Model[b"zone"] = g.Secret
        g.Model[b"map"] = g.Secret
        g.Fire(b"ZONE_CHANGED_NEW_AREA")
        after = self.snapshot()
        self.assertEqual(after["name"], before["name"])
        self.assertEqual(after["level"], before["level"])
        self.assertEqual(after["class"], before["class"])
        self.assertEqual(after["map"], 0)

    def test_utf8_bounded_frame_handles_control_characters(self):
        protocol = self.ns[b"Protocol"]
        snapshot = self.lua.globals().WoWMapCompanionDB[b"snapshot"]
        for key in (b"name", b"realm", b"zone"):
            snapshot[key] = ("测试" * 100).encode() + b'"\\\n'
        frame, payload, _ = protocol[b"Encode"](snapshot)
        self.assertEqual(len(frame), 512)
        self.assertLessEqual(len(payload), 504)
        self.assertIsInstance(json.loads(payload), dict)
        for length in range(13):
            prefix = protocol[b"UTF8Prefix"]("中文测试".encode(), length)
            prefix.decode("utf-8")
            self.assertLessEqual(len(prefix), length)

    def test_json_quotes_controls_and_backslash_round_trip(self):
        protocol = self.ns[b"Protocol"]
        snapshot = self.lua.globals().WoWMapCompanionDB[b"snapshot"]
        snapshot[b"zone"] = b'zone"\\\n\x00'
        frame, payload, _ = protocol[b"Encode"](snapshot)
        self.assertEqual(json.loads(payload)["zone"], 'zone"\\\n\x00')
        self.assertEqual(len(frame), 512)

    def test_invalid_commands_do_not_change_settings(self):
        g = self.lua.globals()
        command = g.SlashCmdList[b"WOWMAPCOMPANION"]
        command(b"cell 0")
        command(b"cell 2.5")
        self.assertEqual(g.WoWMapCompanionDB[b"settings"][b"cell"], 2)
        command(b"pos 16 24")
        self.assertEqual(g.WoWMapCompanionDB[b"settings"][b"x"], 16)
        command(b"telemetry")
        self.assertFalse(g.Objects[b"WoWCompanionTelemetry"][b"shown"])
        command(b"reset")
        self.assertTrue(g.Objects[b"WoWCompanionTelemetry"][b"shown"])
        self.assertAlmostEqual(g.Objects[b"WoWCompanionTelemetry"][b"scale"], (768 / 1600) / .7)

    def assert_physical_layout(self, cell, x, y):
        g = self.lua.globals()
        frame = g.Objects[b"WoWCompanionTelemetry"]
        self.assertTrue(frame[b"roundLayout"])
        # The engine maps 768 UI units to the physical viewport height at scale 1.
        ui_to_pixel = g.Screen[b"height"] / 768
        factor = frame[b"GetEffectiveScale"](frame) * ui_to_pixel
        self.assertAlmostEqual(frame[b"width"] * factor, 64 * cell)
        self.assertAlmostEqual(frame[b"height"] * factor, 64 * cell)
        self.assertAlmostEqual(frame[b"point"][4] * factor, x)
        self.assertAlmostEqual(-frame[b"point"][5] * factor, y)
        for index in (1, 2, 64, 65, 4096):
            texture = frame[b"textures"][index]
            self.assertTrue(texture[b"roundLayout"])
            self.assertAlmostEqual(texture[b"width"] * factor, cell)
            self.assertAlmostEqual(texture[b"height"] * factor, cell)
            self.assertAlmostEqual(texture[b"point"][4] * factor, ((index - 1) % 64) * cell)
            self.assertAlmostEqual(-texture[b"point"][5] * factor, ((index - 1) // 64) * cell)

    def test_cell_and_origin_stay_in_physical_pixels_after_scale_and_display_events(self):
        g = self.lua.globals()
        command = g.SlashCmdList[b"WOWMAPCOMPANION"]
        command(b"pos 17 15")
        for cell in (1, 2):
            command(f"cell {cell}".encode())
            for height in (768, 1080, 1600, 2160):
                with self.subTest(cell=cell, height=height):
                    g.Screen[b"height"] = height
                    g.Fire(b"DISPLAY_SIZE_CHANGED")
                    self.assert_physical_layout(cell, 17, 15)
                    for scale in (.64, .7, 1, 1.25):
                        g.UIParent[b"scale"] = scale
                        g.Fire(b"UI_SCALE_CHANGED")
                        self.assert_physical_layout(cell, 17, 15)
        settings = g.WoWMapCompanionDB[b"settings"]
        self.assertEqual((settings[b"x"], settings[b"y"], settings[b"cell"]), (17, 15, 2))

    def test_physical_screen_height_is_used_when_pixel_util_is_unavailable(self):
        g = self.lua.globals()
        g.SlashCmdList[b"WOWMAPCOMPANION"](b"cell 1")
        self.lua.execute(b"PixelUtil=nil")
        for height in (1080, 1600, 2160):
            with self.subTest(height=height):
                g.Screen[b"height"] = height
                g.Fire(b"DISPLAY_SIZE_CHANGED")
                self.assert_physical_layout(1, 8, 8)

    def test_heartbeat_repairs_late_scale_changes_without_relaying_out_stable_frames(self):
        g = self.lua.globals()
        command = g.SlashCmdList[b"WOWMAPCOMPANION"]
        command(b"pos 8 32")
        command(b"cell 1")
        frame = g.Objects[b"WoWCompanionTelemetry"]
        cell = frame[b"textures"][4096]
        before = frame[b"sizeWrites"]
        cell_before = cell[b"sizeWrites"]
        # Login can change UIParent after its last scale event. No event is fired here.
        g.UIParent[b"scale"] = .7 * 1.125
        physical_width = frame[b"width"] * frame[b"GetEffectiveScale"](frame) * g.Screen[b"height"] / 768
        self.assertAlmostEqual(physical_width, 72)
        g.Heartbeat()
        self.assert_physical_layout(1, 8, 32)
        self.assertEqual(frame[b"sizeWrites"], before + 1)
        self.assertEqual(cell[b"sizeWrites"], cell_before + 1)
        # The physical conversion can also change before a display notification.
        g.Screen[b"height"] = 2160
        g.Heartbeat()
        self.assert_physical_layout(1, 8, 32)
        self.assertEqual(frame[b"sizeWrites"], before + 2)
        self.assertEqual(cell[b"sizeWrites"], cell_before + 2)
        for _ in range(3):
            g.Heartbeat()
        self.assertEqual(frame[b"sizeWrites"], before + 2)
        self.assertEqual(cell[b"sizeWrites"], cell_before + 2)

    def test_pixel_snap_is_restored_after_ndui_color_texture_hook(self):
        lua = LuaRuntime(encoding=None, unpack_returned_tuples=True)
        lua.execute(MOCK)
        lua.globals().NDuiPixelSnapHook = True
        ns = lua.table()
        load = lua.eval(b"function(source, ns) assert(loadstring(source))('WoWMapCompanion', ns) end")
        for name in ("Protocol.lua", "Telemetry.lua"):
            load((ROOT / name).read_bytes(), ns)
        config = lua.table_from({b"telemetry": True, b"cell": 1, b"x": 8, b"y": 32})
        ns[b"Telemetry"][b"Initialize"](config)
        textures = lua.globals().Objects[b"WoWCompanionTelemetry"][b"textures"]
        # NDui disables snapping after every SetColorTexture, including initialization.
        for index in range(1, 4097):
            self.assertEqual(textures[index][b"writes"], 1)
            self.assertTrue(textures[index][b"snapToPixelGrid"])
            self.assertEqual(textures[index][b"texelSnappingBias"], 0)
        for writes, payload in enumerate((b"\x00" * 512, b"\xff" * 512), start=2):
            ns[b"Telemetry"][b"Render"](payload)
            for index in range(1, 4097):
                self.assertEqual(textures[index][b"writes"], writes)
                self.assertTrue(textures[index][b"snapToPixelGrid"])


if __name__ == "__main__":
    unittest.main()
