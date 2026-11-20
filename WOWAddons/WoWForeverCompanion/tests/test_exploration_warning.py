"""Exercise outdoor boundaries, fresh levels, and the real Lua warning payload."""
import json
import unittest

import test_addon


class ExplorationWarningTest(unittest.TestCase):
    def setUp(self):
        self.lua = test_addon.LuaRuntime(encoding=None, unpack_returned_tuples=True)
        self.lua.execute(test_addon.MOCK)
        self.lua.execute(b'''
            Clock=10
            function GetLocale() return "zhCN" end
            function GetTime() return Clock end
            C_PvP={GetZonePVPInfo=function()
                if Model.territoryError then error("unavailable") end
                return Model.territory
            end}
            function GetInstanceInfo() return "World", Model.instanceType or "none" end
            UIErrorsFrame={AddMessage=function(_, text) Alert=text; Alerts=(Alerts or 0)+1 end}
            Model.level=15; Model.faction="Horde"; Model.map=1413; Model.zone="Barrens"
        ''')
        self.g = self.lua.globals()
        self.ns = self.lua.table()
        load = self.lua.eval(b"function(source,name,ns) assert(loadstring(source))(name,ns) end")
        root = test_addon.ROOT
        for line in (root / (root.name + '.toc')).read_text('utf-8').splitlines():
            if line.endswith('.lua'):
                load((root / line).read_bytes(), root.name.encode(), self.ns)
        self.lua.eval(b'''function(ns)
            local encode = ns.Protocol.EncodePulse
            ns.Protocol.EncodePulse = function(...)
                LatestPulse = encode(...)
                return LatestPulse
            end
        end''')(self.ns)
        self.g.Fire(b'ADDON_LOADED', root.name.encode())
        self.g.Fire(b'PLAYER_ENTERING_WORLD')

    def enter(self, map_id=1424, territory=b'contested'):
        self.g.Model[b'map'] = map_id
        self.g.Model[b'territory'] = territory
        self.g.Fire(b'ZONE_CHANGED_NEW_AREA')

    def settle(self, seconds=0.25):
        self.g.Clock += seconds
        self.g.RetryTimers()

    def read_pulse(self):
        frame = self.g.LatestPulse
        self.assertEqual(frame[:4], b'WCF1')
        size = int.from_bytes(frame[4:6], 'little')
        return json.loads(frame[8:8 + size])

    def test_low_level_horde_warrior_warns_once_at_hillsbrad_boundary(self):
        self.g.Model[b'class'] = b'WARRIOR'
        self.enter()
        self.assertIsNone(self.g.Alert)
        self.settle()
        self.assertEqual(self.g.Alert.decode(), '前面的区域，以后再来探索吧')
        self.assertTrue(self.g.Messages[len(self.g.Messages)].decode().endswith('前面的区域，以后再来探索吧'))
        for event in (b'ZONE_CHANGED', b'ZONE_CHANGED_INDOORS', b'PLAYER_LEVEL_UP'):
            self.g.Fire(event, 16)
        self.g.Heartbeat()
        self.g.RetryTimers()
        self.assertEqual(self.g.Alerts, 1)
        payload = self.read_pulse()
        self.assertEqual(payload['w'], {'id': 1, 'map': 1424, 'level': 15, 'min': 20})
        self.assertEqual(payload['p']['map'], 1424)
        self.assertEqual(payload['p']['instanceType'], 'none')

    def test_minimum_level_and_higher_do_not_warn(self):
        for level in (20, 21, 60):
            with self.subTest(level=level):
                self.setUp()
                self.g.Model[b'level'] = level
                self.enter()
                self.settle()
                self.assertIsNone(self.g.Alert)

    def test_territory_and_faction_are_not_required(self):
        for territory in (b'friendly', b'sanctuary', b'unknown', None, 42):
            with self.subTest(territory=territory):
                self.setUp()
                self.g.Model[b'faction'] = b'Neutral'
                self.enter(territory=territory)
                self.settle()
                self.assertEqual(self.g.Alerts, 1)
        self.setUp()
        self.enter(territory=self.g.Secret)
        self.settle()
        self.assertEqual(self.g.Alerts, 1)

    def test_unknown_map_level_and_instance_do_not_warn(self):
        for map_id in (2482, 999999):
            self.enter(map_id)
            self.settle()
            self.assertIsNone(self.g.Alert)
        self.g.Model[b'instanceType'] = b'party'
        self.enter()
        self.settle()
        self.assertIsNone(self.g.Alert)
        self.g.Model[b'instanceType'] = b'none'
        self.g.Fire(b'PLAYER_DEAD')
        self.enter(1434)
        self.settle()
        self.assertIsNone(self.g.Alert)

    def test_hover_range_matches_the_documented_bound_instead_of_the_old_estimate(self):
        self.g.Model[b'level'] = 18
        self.enter(1440)
        self.settle()
        self.assertIsNone(self.g.Alert)
        self.enter(2548)
        self.settle()
        self.g.Heartbeat()
        self.assertEqual(self.read_pulse()['w'], {'id': 1, 'map': 2548, 'level': 18, 'min': 35})
        self.assertEqual(self.ns[b'ExplorationLevels'][1434][b'max'], 45)

    def test_stale_or_restricted_level_cannot_create_a_warning(self):
        self.g.Model[b'level'] = self.g.Secret
        self.enter()
        self.settle()
        self.assertIsNone(self.g.Alert)
        self.g.Model[b'level'] = 20
        self.g.Heartbeat()
        self.assertIsNone(self.g.Alert)

    def test_login_and_character_switch_only_establish_baseline(self):
        self.g.Model[b'guid'] = b'Player-other'
        self.enter()
        self.settle()
        self.assertIsNone(self.g.Alert)
        self.g.Fire(b'PLAYER_ENTERING_WORLD')
        self.settle()
        self.assertIsNone(self.g.Alert)

    def test_delayed_scene_is_retried_but_not_after_five_seconds(self):
        self.g.Model[b'instanceType'] = b'unknown'
        self.enter()
        self.settle()
        self.g.Model[b'instanceType'] = b'none'
        self.g.Heartbeat()
        self.assertEqual(self.g.Alerts, 1)
        self.setUp()
        self.g.Model[b'instanceType'] = b'unknown'
        self.enter()
        self.settle(6)
        self.g.Model[b'instanceType'] = b'none'
        self.g.Heartbeat()
        self.assertIsNone(self.g.Alert)

    def test_fast_crossing_cancels_old_destination_and_reentry_can_warn(self):
        self.enter()
        self.enter(1413)
        self.settle()
        self.assertIsNone(self.g.Alert)
        self.enter()
        self.settle()
        self.assertEqual(self.g.Alerts, 1)

    def test_loading_unknown_map_does_not_create_an_arrival_on_return(self):
        self.enter()
        self.settle()
        self.g.Fire(b'PLAYER_LEAVING_WORLD')
        self.enter(0)
        self.g.Fire(b'PLAYER_ENTERING_WORLD')
        self.enter()
        self.settle()
        self.assertEqual(self.g.Alerts, 1)

    def test_warning_pulse_expires_and_reentry_has_a_new_identifier(self):
        self.enter()
        self.settle()
        self.g.Heartbeat()
        self.assertEqual(self.read_pulse()['w']['id'], 1)
        for _ in range(12):
            self.g.Heartbeat()
        self.assertNotIn('w', self.read_pulse())
        self.enter(1413)
        self.settle()
        self.enter()
        self.settle()
        self.assertEqual(self.read_pulse()['w']['id'], 2)


if __name__ == '__main__':
    unittest.main()
