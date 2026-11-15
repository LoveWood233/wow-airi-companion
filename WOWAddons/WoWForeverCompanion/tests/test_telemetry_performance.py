"""Exercise real Lua encoding and drawing work without a game client or paid services."""
import json
import sys
import unittest

from test_addon import LuaRuntime, MOCK, ROOT

bridge_path = str(ROOT.parent / 'WoWCompanionBridge')
sys.path.append(bridge_path)
try:
    from protocol import decode_frame, decode_pixels
finally:
    sys.path.remove(bridge_path)


class SnapshotCacheTests(unittest.TestCase):
    def setUp(self):
        self.lua = LuaRuntime(encoding=None, unpack_returned_tuples=True)
        self.lua.execute(MOCK)
        self.ns, self.g = self.lua.table(), self.lua.globals()
        self.g.NS = self.ns
        load = self.lua.eval(b'function(source,name,ns) assert(loadstring(source))(name,ns) end')
        for name in ('Protocol.lua', 'Money.lua', 'Equipment.lua', 'Transfer.lua', 'OfflineHistory.lua',
                     'EquipmentCompare.lua', 'ConfirmEquip.lua', 'Inventory.lua', 'ItemStorage.lua',
                     'Quests.lua', 'Talents.lua', 'WeaponSkills.lua', 'Telemetry.lua', ROOT.name + '.lua'):
            load((ROOT / name).read_bytes(), ROOT.name.encode(), self.ns)
        self.g.Fire(b'ADDON_LOADED', ROOT.name.encode())
        self.g.Fire(b'PLAYER_ENTERING_WORLD', True, False)
        self.lua.execute(b'''BaseEncodeCalls=0; HistoryCalls=0; SavingCalls=0
local encode=NS.Protocol.Encode
NS.Protocol.Encode=function(...) BaseEncodeCalls=BaseEncodeCalls+1; return encode(...) end
local observe=NS.OfflineHistory.Observe
NS.OfflineHistory.Observe=function(snapshot,payload,saving)
 HistoryCalls=HistoryCalls+1; if saving then SavingCalls=SavingCalls+1 end
 return observe(snapshot,payload,saving)
end''')

    def snapshot(self):
        return json.loads(self.g[(ROOT.name + 'DB').encode()][b'snapshotJSON'])

    def test_fragment_rotation_reuses_snapshot_encoding_and_history(self):
        for _ in range(20):
            self.g.Tickers[2][b'callback']()
        self.assertEqual(self.g.BaseEncodeCalls, 0)
        self.assertEqual(self.g.HistoryCalls, 0)

    def test_heartbeat_encodes_once_per_second_not_once_per_screen_refresh(self):
        for _ in range(10):
            self.g.Tickers[1][b'callback']()
            for _ in range(4):
                self.g.Tickers[2][b'callback']()
        self.assertEqual(self.g.BaseEncodeCalls, 10)
        self.assertEqual(self.g.HistoryCalls, 10)
        self.assertEqual(self.snapshot()['tick'], 10)

    def test_business_events_publish_without_waiting_for_a_heartbeat(self):
        self.g.Model[b'level'] = 35
        self.g.Fire(b'PLAYER_LEVEL_UP', 35)
        self.assertEqual(self.snapshot()['level'], 35)
        self.assertEqual(self.g.BaseEncodeCalls, 1)
        self.g.Model[b'copper'] = 125000
        self.g.Fire(b'PLAYER_MONEY')
        self.assertEqual(self.snapshot()['copper'], 125000)
        self.assertEqual(self.g.BaseEncodeCalls, 2)
        self.g.Model[b'combat'] = True
        self.g.Fire(b'PLAYER_REGEN_DISABLED')
        self.assertTrue(self.snapshot()['combat'])
        self.assertEqual(self.g.BaseEncodeCalls, 3)

    def test_logout_forces_history_save_even_after_an_offline_snapshot(self):
        self.g.Fire(b'PLAYER_LEAVING_WORLD')
        self.assertFalse(self.snapshot()['online'])
        before = self.g.SavingCalls
        self.g.Fire(b'PLAYER_LOGOUT')
        self.assertGreater(self.g.SavingCalls, before)
        self.assertFalse(self.snapshot()['online'])

    def test_brightness_command_is_bounded_persisted_and_does_not_change_frame_data(self):
        db = self.g[(ROOT.name + 'DB').encode()]
        self.assertEqual(db[b'settings'][b'brightness'], 85)
        key = b'WOWFOREVERCOMPANION' if ROOT.name == 'WoWForeverCompanion' else b'WOWMAPCOMPANION'
        command = self.g.SlashCmdList[key]
        command(b'contrast 100')
        self.assertEqual(db[b'settings'][b'brightness'], 100)
        for value in (b'0', b'84', b'101', b'85.5', b'nan'):
            command(b'contrast ' + value)
            self.assertEqual(db[b'settings'][b'brightness'], 100)
        command(b'contrast 85')
        self.assertEqual(db[b'settings'][b'brightness'], 85)
        self.assertEqual(self.g.BaseEncodeCalls, 0)


class PixelRenderingTests(unittest.TestCase):
    def setUp(self):
        self.lua = LuaRuntime(encoding=None, unpack_returned_tuples=True)
        self.lua.execute(MOCK)
        self.ns, self.g = self.lua.table(), self.lua.globals()
        load = self.lua.eval(b'function(source,name,ns) assert(loadstring(source))(name,ns) end')
        for name in ('Protocol.lua', 'Telemetry.lua'):
            load((ROOT / name).read_bytes(), ROOT.name.encode(), self.ns)
        self.config = self.lua.table_from({b'telemetry': True, b'cell': 1, b'x': 8, b'y': 8})
        self.ns[b'Telemetry'][b'Initialize'](self.config)
        key = b'WoWForeverCompanionTelemetry' if ROOT.name == 'WoWForeverCompanion' else b'WoWCompanionTelemetry'
        self.frame = self.g.Objects[key]

    def count_reads(self):
        self.lua.execute(b'''ByteReads=0
local byte=string.byte
string.byte=function(...) ByteReads=ByteReads+1; return byte(...) end''')

    def test_identical_frames_skip_pixel_decoding(self):
        payload = bytes(512)
        self.ns[b'Telemetry'][b'Render'](payload)
        self.count_reads()
        for _ in range(20):
            self.ns[b'Telemetry'][b'Render'](payload)
        self.assertEqual(self.g.ByteReads, 0)

    def test_all_pixels_preserve_network_bit_order(self):
        payload = bytes((index * 37 + 11) % 256 for index in range(512))
        self.ns[b'Telemetry'][b'Render'](payload)
        for offset, byte in enumerate(payload):
            for bit in range(8):
                expected = ((byte >> (7 - bit)) & 1) * .85
                color = self.frame[b'textures'][offset * 8 + bit + 1][b'color']
                self.assertEqual(tuple(color[index] for index in range(1, 5)), (expected, expected, expected, 1))

    def test_one_changed_byte_does_not_decode_the_entire_bit_grid(self):
        self.ns[b'Telemetry'][b'Render'](bytes(512))
        before = sum(self.frame[b'textures'][index][b'writes'] for index in range(1, 4097))
        self.count_reads()
        self.ns[b'Telemetry'][b'Render'](bytes([255]) + bytes(511))
        self.assertLessEqual(self.g.ByteReads, 512)
        after = sum(self.frame[b'textures'][index][b'writes'] for index in range(1, 4097))
        self.assertEqual(after - before, 8)

    def test_cached_frame_still_repairs_layout_after_a_resolution_change(self):
        payload = bytes(512)
        self.ns[b'Telemetry'][b'Render'](payload)
        before = self.frame[b'sizeWrites']
        self.g.Screen[b'height'] = 2160
        self.ns[b'Telemetry'][b'Render'](payload)
        self.assertEqual(self.frame[b'sizeWrites'], before + 1)
        self.assertAlmostEqual(self.frame[b'scale'], (768 / 2160) / self.g.UIParent[b'scale'])

    def test_dimmed_pixels_decode_with_the_unchanged_bridge_and_high_contrast_can_be_restored(self):
        game = 'forever' if ROOT.name == 'WoWForeverCompanion' else 'retail'
        protocol = 'WCF1' if game == 'forever' else 'WCP1'
        frame = (ROOT / 'tests' / 'fixtures' / ('lua-' + game + '-weapon-skills.bin')).read_bytes()[:512]
        expected = decode_frame(frame, protocol)
        for brightness in (85, 90, 100, 85):
            self.config[b'brightness'] = brightness
            self.ns[b'Telemetry'][b'Render'](frame)
            pixels = bytearray()
            for index in range(1, 4097):
                color = self.frame[b'textures'][index][b'color']
                channel = round(color[1] * 255)
                pixels.extend((channel, channel, channel, 255))
            self.assertEqual(decode_pixels(bytes(pixels), 64, 64, 1, protocol), expected)


if __name__ == '__main__':
    unittest.main()
