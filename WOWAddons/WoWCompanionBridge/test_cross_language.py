"""Optional integration test: actual Lua addon -> pixels -> Python -> level event."""

import importlib.util
import json
import sys
import unittest
from pathlib import Path

from protocol import decode_frame, decode_pixels, pixels_for_frame
from state import CompanionState

ADDON = Path(__file__).resolve().parent.parent / "WoWMapCompanion"
sys.path.insert(0, str(ADDON / "tests" / ".deps"))
try:
    from lupa.lua51 import LuaRuntime
except ImportError:
    LuaRuntime = None


@unittest.skipUnless(LuaRuntime and (ADDON / "tests" / "test_addon.py").exists(),
                     "可选联测需要 WoWMapCompanion/tests/.deps 中的 lupa Lua 5.1")
class LuaBridgeIntegrationTests(unittest.TestCase):
    def test_real_lua_movement_and_unavailable_positions_for_both_games(self):
        for addon, name, game, protocol in (
            (ADDON, "WoWMapCompanion", "retail", "WCP1"),
            (ADDON.parent / "WoWForeverCompanion", "WoWForeverCompanion", "forever", "WCF1"),
        ):
            with self.subTest(game=game):
                spec = importlib.util.spec_from_file_location("wow_position_harness", addon / "tests" / "test_addon.py")
                harness = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(harness)
                lua = LuaRuntime(encoding=None, unpack_returned_tuples=True)
                lua.execute(harness.MOCK)
                lua.execute(b'''CoordX, CoordY = 0.1234, 0.5678
function C_Map.GetPlayerMapPosition(map, unit)
  assert(map == Model.map and unit == "player")
  return {GetXY=function() return CoordX, CoordY end}
end''')
                ns = lua.table()
                loader = lua.eval(b"function(source, name, ns) assert(loadstring(source))(name, ns) end")
                for filename in (line.strip() for line in (addon / f"{name}.toc").read_text(encoding="utf-8-sig").splitlines()
                                 if line.strip().endswith(".lua") and not line.lstrip().startswith("#")):
                    loader((addon / filename).read_bytes(), name.encode(), ns)
                g = lua.globals()
                g.Fire(b"ADDON_LOADED", name.encode())
                g.Fire(b"PLAYER_ENTERING_WORLD")
                engine = CompanionState(game=game)

                def transfer():
                    frame, _, _ = ns[b"Protocol"][b"Encode"](g[(name + "DB").encode()][b"snapshot"])
                    decoded = decode_pixels(pixels_for_frame(frame, 1), 64, 64, 1, protocol)
                    engine.ingest(decoded)
                    return decoded

                first = transfer()
                self.assertEqual((first["px"], first["py"]), (1234, 5678))
                g.CoordX, g.CoordY = 0.4321, 0.8765
                g.Heartbeat()
                moved = transfer()
                self.assertEqual((moved["px"], moved["py"]), (4321, 8765))
                self.assertGreater(moved["seq"], first["seq"])
                self.assertGreater(moved["tick"], first["tick"])
                self.assertEqual([event["type"] for event in engine.view()["events"]], ["connected"])
                # A changed map with unavailable public position cannot retain the old map's coordinates.
                g.Model[b"map"] = 37
                g.Model[b"zone"] = b"Elwynn Forest"
                lua.execute(b"C_Map.GetPlayerMapPosition=function() return nil end")
                g.Fire(b"ZONE_CHANGED_NEW_AREA")
                unknown = transfer()
                self.assertEqual(unknown["map"], 37)
                self.assertIsNone(unknown["px"])
                self.assertIsNone(unknown["py"])
                self.assertEqual([event["type"] for event in engine.view()["events"]], ["connected", "zone"])
                g.Fire(b"PLAYER_LEAVING_WORLD")
                offline = transfer()
                self.assertFalse(offline["online"])
                self.assertIsNone(offline["px"])
                self.assertIsNone(offline["py"])

    def test_login_profile_and_event_frames_use_the_same_real_screen_carrier(self):
        cases = ((ADDON, "WoWMapCompanion", "retail", "WCP1"),
                 (ADDON.parent / "WoWForeverCompanion", "WoWForeverCompanion", "forever", "WCF1"))
        for addon, name, game, protocol in cases:
            with self.subTest(game=game):
                spec = importlib.util.spec_from_file_location("wow_event_harness", addon / "tests" / "test_addon.py")
                harness = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(harness)
                lua = LuaRuntime(encoding=None, unpack_returned_tuples=True)
                lua.execute(harness.MOCK)
                lua.execute(b'''
Clock, Quantity, Health, Experience, FactionStanding = 0, 2, 100, 15, 125
function UnitXP() return Experience end
function UnitXPMax() return 100 end
QuestProgress = 0
C_QuestLog = {
    GetNumQuestLogEntries = function() return 1, 1 end,
    GetInfo = function() return {questID=100, title="Mock quest", level=29, isHeader=false} end,
    ReadyForTurnIn = function() return QuestProgress == 2 end,
    IsFailed = function() return false end,
    GetAllCompletedQuestIDs = function() return {} end,
    GetQuestObjectives = function() return {{text="Items collected", type="item",
        numFulfilled=QuestProgress, numRequired=2, finished=QuestProgress == 2}} end,
}
C_Reputation = {
    GetNumFactions = function() return 1 end,
    GetFactionDataByIndex = function() return {factionID=72,name="Stormwind",reaction=4,
        currentStanding=FactionStanding,currentReactionThreshold=0,nextReactionThreshold=3000,isHeader=false} end,
}
function RequestRaidInfo() RaidRequested = true end
function GetNumSavedInstances() return 1 end
function GetSavedInstanceInfo() return "Mock dungeon", 31, 1700086400 - GetServerTime(), 2, true, false end
C_DateAndTime = {GetCurrentCalendarTime = function() return {year=2026,month=11,monthDay=16} end}
C_Calendar = {
    OpenCalendar = function() end,
    GetMonthInfo = function() return {year=2026,month=11} end,
    GetNumDayEvents = function() return 0 end,
}
function GetTime() return Clock end
function GetServerTime() return 1700000000 + math.floor(Clock) end
function UnitHealth() return Health end
function UnitHealthMax() return 100 end
NUM_TOTAL_EQUIPPED_BAG_SLOTS = 0
local link = "|Hitem:2589|h[Linen Cloth]|h"
C_Container = {
  GetContainerNumSlots = function(bag) return bag == 0 and 1 or 0 end,
  GetContainerItemInfo = function(bag, slot)
    if bag == 0 and slot == 1 and Quantity > 0 then
      return { itemID = 2589, hyperlink = link, stackCount = Quantity }
    end
  end,
}
C_Item = {
  GetItemInfoInstant = function() return 2589, "Tradeskill", "Cloth", "", nil, 7, 5 end,
  GetItemInfo = function() return "Linen Cloth", link, 1, 5, 0, "Tradeskill", "Cloth", 200, "" end,
}
function UpdateTime(step)
  Clock = Clock + step
  for _, timer in ipairs(Timers) do
    if not timer.cancelled then timer.due = timer.due or Clock + timer.delay end
    if not timer.cancelled and timer.due <= Clock then timer.cancelled = true; timer.callback() end
  end
end
''')
                ns = lua.table()
                g = lua.globals()
                g.NS = ns
                load = lua.eval(b"function(source, name, ns) assert(loadstring(source))(name, ns) end")
                for line in (addon / f"{name}.toc").read_text(encoding="utf-8-sig").splitlines():
                    line = line.strip()
                    if line.endswith(".lua") and not line.startswith("#"):
                        load((addon / line).read_bytes(), name.encode(), ns)
                lua.execute(b'''local render = NS.Telemetry.Render
NS.Telemetry.Render = function(frame) Wire = frame; render(frame) end''')
                g.Fire(b"ADDON_LOADED", name.encode())
                engine = CompanionState(game=game, clock=lambda: g.Clock, wall_clock=lambda: 1700000000 + g.Clock)
                frames = []

                def observe():
                    value = decode_pixels(pixels_for_frame(g.Wire, 1), 64, 64, 1, protocol)
                    frames.append(value)
                    engine.ingest(value)
                    return value

                def step(seconds):
                    for index in range(seconds * 4):
                        g.UpdateTime(.25)
                        if index % 4 == 3:
                            g.Tickers[1][b"callback"]()
                        g.Tickers[2][b"callback"]()
                        observe()

                g.Fire(b"PLAYER_ENTERING_WORLD", True, False)
                self.assertEqual(observe()["level"], 29)
                g.Fire(b"CALENDAR_UPDATE_EVENT_LIST")
                step(13)
                self.assertTrue(g.RaidRequested)
                g.Fire(b"UPDATE_INSTANCE_INFO")
                step(12)
                baseline = engine.view()
                self.assertTrue(baseline["lowFrequency"])
                self.assertEqual(baseline["archive"]["progress"]["data"]["xp"], 15)
                self.assertEqual(baseline["inventory"]["items"], [{"itemID": 2589, "quantity": 2}])
                self.assertEqual(baseline["archive"]["reputation"]["data"]["entries"][0]["value"], 125)
                self.assertEqual(baseline["archive"]["lockouts"]["data"]["entries"][0]["resetAt"], 1700086400)
                self.assertEqual(baseline["calendar"], {"day": "2026-11-16", "items": []})
                self.assertEqual(baseline["quests"]["log"]["entries"][0]["objectives"][0]["fulfilled"], 0)
                later = len(frames)
                g.Model[b"level"], g.Model[b"copper"] = 32, 103500
                g.Experience, g.FactionStanding, g.QuestProgress = 35, 170, 2
                g.Fire(b"QUEST_LOG_UPDATE")
                g.Fire(b"PLAYER_MONEY")
                g.Fire(b"PLAYER_LEVEL_UP", 32)
                step(3)
                steady = [frame for frame in frames[later:] if frame.get("kind") == "pulse"]
                self.assertTrue(steady)
                self.assertTrue(all(set(frame) == {"v", "kind", "s", "g", "q", "t", "on", "c", "d", "lf"} for frame in steady))
                self.assertTrue(all(frame.get("kind") for frame in frames[later:]))
                self.assertEqual((engine.view()["snapshot"]["level"], engine.view()["snapshot"]["copper"]), (29, 100000))
                saved = json.loads(g[(name + "DB").encode()][b"snapshotJSON"])
                self.assertEqual((saved["level"], saved["copper"]), (32, 103500))

                g.Fire(b"PLAYER_LEAVING_WORLD")
                observe()
                g.Model[b"map"], g.Model[b"zone"] = 37, b"Elwynn Forest"
                g.Fire(b"PLAYER_ENTERING_WORLD", False, False)
                g.Tickers[2][b"callback"]()
                step(1)
                self.assertEqual(engine.view()["snapshot"]["map"], 37)
                self.assertIn("zone", [event["type"] for event in engine.view()["events"]])
                if game == "forever":
                    lua.execute(b'function IsInInstance() return false, "none" end')
                    # The wire profile still says 29. The live level of 32 meets the 30 minimum.
                    g.Model[b"map"], g.Model[b"zone"] = 1434, "荆棘谷".encode()
                    g.Fire(b"ZONE_CHANGED_NEW_AREA")
                    step(3)
                    self.assertNotIn("level_gate", [event["type"] for event in engine.view()["events"]])
                    g.Model[b"map"], g.Model[b"zone"] = 1427, "灼热峡谷".encode()
                    g.Fire(b"ZONE_CHANGED_NEW_AREA")
                    step(5)
                    warnings = [event for event in engine.view()["events"] if event["type"] == "level_gate"]
                    self.assertEqual([(event["snapshot"]["map"], event["playerLevel"], event["minimumLevel"])
                                      for event in warnings], [(1427, 32, 45)])
                g.Health = 20
                g.Fire(b"PLAYER_REGEN_DISABLED")
                step(1)
                self.assertNotIn("low_health", [event["type"] for event in engine.view()["events"]])
                g.Health = g.Secret
                g.Fire(b"UNIT_HEALTH", b"player")
                step(1)
                self.assertNotIn("low_health", [event["type"] for event in engine.view()["events"]])
                g.Health = 19
                g.Fire(b"UNIT_HEALTH", b"player")
                step(2)
                g.Health = 3
                g.Fire(b"UNIT_HEALTH", b"player")
                step(1)
                g.Fire(b"PLAYER_DEAD")
                step(1)
                g.Quantity = 5
                g.Fire(b"BAG_UPDATE_DELAYED")
                step(7)
                events = engine.view()["events"]
                self.assertEqual([event["healthPercent"] for event in events if event["type"] == "low_health"], [19])
                self.assertEqual([event["quantity"] for event in events if event["type"] == "loot"], [3])
                self.assertEqual(sum(event["type"] == "death" for event in events), 1)
                self.assertTrue(all(frame.get("kind") for frame in frames[later:]))
                early = engine.view()
                self.assertEqual(early["archive"]["progress"]["id"], baseline["archive"]["progress"]["id"])
                self.assertEqual(early["inventory"]["id"], baseline["inventory"]["id"])
                self.assertEqual(early["quests"]["id"], baseline["quests"]["id"])
                # Refresh the wire without simulating six minutes of 64x64 texture copies.
                g.Clock = 360
                step(12)
                g.Fire(b"UPDATE_INSTANCE_INFO")
                step(10)
                changed = engine.view()
                self.assertEqual(changed["archive"]["progress"]["data"]["copper"], "103500")
                self.assertEqual(changed["archive"]["progress"]["data"]["xp"], 35)
                self.assertEqual(changed["archive"]["reputation"]["data"]["entries"][0]["value"], 170)
                self.assertEqual(changed["inventory"]["items"], [{"itemID": 2589, "quantity": 5}])
                self.assertEqual(changed["quests"]["log"]["entries"][0]["objectives"][0]["fulfilled"], 2)
                self.assertEqual(changed["archive"]["lockouts"]["id"], baseline["archive"]["lockouts"]["id"])
                self.assertEqual(changed["archive"]["schedule"]["id"], baseline["archive"]["schedule"]["id"])

    def test_real_lua_level_event_to_python_pixels_to_state(self):
        self.check_game(ADDON, "WoWMapCompanion", "retail", "WCP1", 2)

    def test_forever_lua_level_and_money_at_cell_one(self):
        self.check_game(ADDON.parent / "WoWForeverCompanion", "WoWForeverCompanion", "forever", "WCF1", 1)

    def check_game(self, addon, name, game, protocol, cell):
        spec = importlib.util.spec_from_file_location("wow_addon_harness", addon / "tests" / "test_addon.py")
        harness = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(harness)
        lua = LuaRuntime(encoding=None, unpack_returned_tuples=True)
        lua.execute(harness.MOCK)
        ns = lua.table()
        loader = lua.eval(b"function(source, name, ns) local f, err=loadstring(source); assert(f,err); return f(name, ns) end")
        filenames = [line.strip() for line in (addon / f"{name}.toc").read_text(encoding="utf-8-sig").splitlines()
                     if line.strip().endswith(".lua") and not line.lstrip().startswith("#")]
        for filename in filenames:
            loader((addon / filename).read_bytes(), name.encode(), ns)
        g = lua.globals()
        if game == "forever":
            # Both 12-character parts take four UTF-8 bytes per character.
            given, surname = "\U00020000" * 12, "\U00020001" * 12
            g.Model[b"name"], g.Model[b"surname"] = given.encode(), surname.encode()
            g.Model[b"zone"], g.Model[b"realm"] = ("地图" * 16).encode(), ("服务器" * 5).encode()
            lua.execute(b'function UnitNameUnmodified(unit) assert(unit == "player"); return Model.name, Model.surname end')
        g.Fire(b"ADDON_LOADED", name.encode())
        g.Fire(b"PLAYER_ENTERING_WORLD")
        engine = CompanionState(game=game)

        def render_and_ingest():
            frame, _, _ = ns[b"Protocol"][b"Encode"](g[(name + 'DB').encode()][b"snapshot"])
            decoded = decode_frame(frame, protocol)
            pixels = pixels_for_frame(frame, cell_size=cell)
            from_pixels = decode_pixels(pixels, 64 * cell, 64 * cell, cell, protocol)
            self.assertEqual(decoded, from_pixels)
            engine.ingest(from_pixels)

        render_and_ingest()
        self.assertEqual(engine.view()["snapshot"]["level"], 29)
        if game == "forever":
            self.assertEqual(engine.view()["snapshot"]["name"], f"{given} {surname}")
        # UnitLevel intentionally still returns 29: event argument must win in real Lua code.
        g.Fire(b"PLAYER_LEVEL_UP", 30)
        render_and_ingest()
        render_and_ingest()
        g.Heartbeat()
        render_and_ingest()
        events = engine.view()["events"]
        self.assertEqual([e["type"] for e in events], ["connected", "level_up"])
        self.assertEqual(events[-1]["snapshot"]["level"], 30)
        self.assertIn("29", events[-1]["detail"])
        g.Model[b"copper"] = 150000
        g.Fire(b"PLAYER_MONEY")
        g.Model[b"copper"] = 120000
        g.Fire(b"PLAYER_MONEY")
        # No desktop frame was sampled between the gain and the expense.
        render_and_ingest()
        gold = engine.view()["snapshot"]
        self.assertEqual((gold["copper"], gold["earned"], gold["spent"]), (120000, 50000, 30000))
        self.assertTrue(gold["account"])
        self.assertTrue(gold["moneyEpoch"])
        self.assertEqual([event["type"] for event in engine.view()["events"]], ["connected", "level_up"])


if __name__ == "__main__":
    unittest.main()
