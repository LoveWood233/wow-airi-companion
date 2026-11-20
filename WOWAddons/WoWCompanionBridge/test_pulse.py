from __future__ import annotations

import unittest

from connection import ConnectionReader
from geometry import Image
from protocol import FrameError, decode_frame, encode_frame, pixels_for_frame
from state import CompanionState
from test_bridge import snapshot
from test_connection import FakeWindows
from test_equipment_loadout import fragments as gear_fragments, loadout
from test_geometry import FakeCapture
from test_inventory import fragments as inventory_fragments, inventory


def pulse(tick: int = 2, **changes) -> dict:
    return {"v": 1, "kind": "pulse", "s": "test-session", "g": "Player-1-TEST",
            "q": tick, "t": tick, "on": True, "c": False, "d": False, **changes}


def loot(identifier: int = 1, **changes) -> dict:
    return {"v": 1, "kind": "loot", "s": "test-session", "g": "Player-1-TEST",
            "id": identifier, "item": 2589, "name": "亚麻布", "n": 3, **changes}


LOCATION = {"map": 84, "zone": "暴风城", "instanceType": "none", "instanceID": None, "px": 5000, "py": 5100}
ARRIVAL = {**LOCATION, "map": 1434, "zone": "荆棘谷"}
LEVEL_GATE = {"id": 1, "map": 1434, "level": 29, "min": 30}


class PulseTests(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.state = CompanionState(clock=lambda: self.now, wall_clock=lambda: 1700000000 + self.now)

    def feed_frames(self, frames):
        reader = ConnectionReader(FakeWindows(), "retail", clock=lambda: self.now)
        capture = FakeCapture(None)
        for frame in frames:
            raw = pixels_for_frame(frame, 1)
            pixels = bytearray(400 * 300 * 4)
            for row in range(64):
                offset = ((row + 8) * 400 + 8) * 4
                pixels[offset:offset + 256] = raw[row * 256:(row + 1) * 256]
            capture.image = Image(bytes(pixels), 400, 300)
            self.now += 0.1
            try:
                value = reader.read(capture, self.state.config, "WCP1")
            except FrameError as exc:
                self.state.report_connection(reader.diagnostic, source_token=reader.source_token, transient=reader.transient_error)
                self.state.capture_error(str(exc))
            else:
                self.state.report_connection(reader.diagnostic, source_token=reader.source_token, transient=reader.transient_error)
                if value is not None:
                    self.state.ingest(value)
        return reader

    def test_compact_frames_round_trip_both_game_protocols(self):
        for protocol in ("WCP1", "WCF1"):
            for value in (pulse(p=LOCATION, c=True, h={"id": 1, "percent": 19}), loot(name=None)):
                with self.subTest(protocol=protocol, value=value):
                    self.assertEqual(decode_frame(encode_frame(value, protocol), protocol), value)

    def test_rejects_malformed_scene_health_and_inventory_fields(self):
        for value in (pulse(on=1), pulse(p={**LOCATION, "py": None}), pulse(p={**LOCATION, "instanceID": 1}),
                      pulse(h={"id": 1, "percent": 20}), pulse(name="not a compact field"),
                      loot(n=0), loot(name=""), loot(item=True)):
            with self.subTest(value=value), self.assertRaises(FrameError):
                encode_frame(value)

    def test_area_gate_requires_a_living_player_below_the_minimum_in_an_outdoor_area(self):
        value = pulse(p=ARRIVAL, w=LEVEL_GATE)
        self.assertEqual(decode_frame(encode_frame(value, "WCF1"), "WCF1"), value)
        cases = (
            pulse(on=False, p=ARRIVAL, w=LEVEL_GATE),
            pulse(d=True, p=ARRIVAL, w=LEVEL_GATE),
            pulse(p=ARRIVAL, w={**LEVEL_GATE, "level": 30}),
            pulse(p=ARRIVAL, w={**LEVEL_GATE, "min": True}),
            pulse(p=LOCATION, w=LEVEL_GATE),
            pulse(p={**ARRIVAL, "instanceType": "party"}, w=LEVEL_GATE),
        )
        for rejected in cases:
            with self.subTest(value=rejected), self.assertRaises(FrameError):
                encode_frame(rejected, "WCF1")

    def test_area_gate_uses_arrival_level_and_deduplicates_repeats_not_reentries(self):
        state = CompanionState(game="forever")
        state.ingest(snapshot(map=1429, level=36, instanceType="none"))
        state.ingest(pulse(2, w=LEVEL_GATE))  # A warning cannot refer to the previous map.
        state.ingest(pulse(3, p=ARRIVAL))
        state.ingest(pulse(4, p=ARRIVAL, w=LEVEL_GATE))
        state.ingest(pulse(5, p=ARRIVAL, w=LEVEL_GATE))
        state.ingest(pulse(6, p=LOCATION))
        state.ingest(pulse(7, p=ARRIVAL, w={**LEVEL_GATE, "id": 2}))
        warnings = [event for event in state.view()["events"] if event["type"] == "level_gate"]
        self.assertEqual(len(warnings), 2)
        for event in warnings:
            self.assertEqual(event["snapshot"]["map"], 1434)
            self.assertEqual(event["snapshot"]["level"], 36)
            self.assertEqual((event["playerLevel"], event["minimumLevel"]), (29, 30))
            self.assertEqual(event["detail"], "前面的区域，以后再来探索吧")

        self.state.ingest(snapshot())
        self.state.ingest(pulse(2, p=ARRIVAL, w=LEVEL_GATE))
        self.assertNotIn("level_gate", [event["type"] for event in self.state.view()["events"]])

    def test_live_only_pulse_requires_matching_profile(self):
        self.state.ingest(pulse())
        waiting = self.state.view()
        self.assertEqual(waiting["status"], "waiting")
        self.assertIsNone(waiting["snapshot"])
        self.assertTrue(waiting["needsProfile"])
        self.assertIn("/reload", waiting["error"])
        self.state.ingest(snapshot())
        self.state.ingest(pulse())
        self.assertNotIn("needsProfile", self.state.view())
        self.state.ingest(pulse(3, g="Player-1-OTHER"))
        self.assertTrue(self.state.view()["needsProfile"])
        self.assertEqual(self.state.view()["status"], "waiting")

    def test_same_source_heartbeat_preserves_profile_and_clears_old_coordinates(self):
        self.state.ingest(snapshot(px=100, py=200))
        self.state.ingest(pulse())
        current = self.state.view()["snapshot"]
        self.assertEqual((current["name"], current["level"], current["copper"]), ("旅行者", 29, 100000))
        self.assertEqual((current["map"], current["px"], current["py"]), (37, None, None))
        self.state.ingest(pulse(3, p=LOCATION))
        self.state.ingest(pulse(4, p=LOCATION))
        self.state.ingest(pulse(5))
        self.state.ingest(pulse(6, q=3, p={**LOCATION, "map": 51, "zone": "灼热峡谷"}))
        self.assertEqual(self.state.view()["snapshot"]["map"], 84)
        self.assertIsNone(self.state.view()["snapshot"]["px"])
        events = self.state.view()["events"]
        self.assertEqual([event["type"] for event in events], ["connected", "zone"])
        self.assertEqual(events[-1]["snapshot"]["px"], 5000)

    def test_instance_arrival_with_a_delayed_map_and_different_label_budget_is_one_event(self):
        self.state.ingest(snapshot())
        instance = {**LOCATION, "map": 0, "zone": "测试副本", "instanceType": "party",
                    "instanceID": 12, "px": None, "py": None}
        self.state.ingest(pulse(2, p=instance))
        self.state.ingest(pulse(3, p={**instance, "map": 99, "zone": "测试副本全称"}))
        self.state.ingest(pulse(4, p={**instance, "map": 99, "instanceID": 13}))
        events = [event for event in self.state.view()["events"] if event["type"] == "zone"]
        self.assertEqual([event["snapshot"]["instanceID"] for event in events], [12, 13])

    def test_profile_observation_time_stays_fixed_until_reload(self):
        self.state.ingest(snapshot())
        self.assertNotIn("profileObservedAt", self.state.view()["snapshot"])
        self.now = 3
        self.state.ingest(snapshot(seq=2, tick=2))
        self.now = 4
        self.state.ingest(pulse(3))
        self.assertEqual(self.state.view()["snapshot"]["profileObservedAt"], 1700000000000)
        self.assertEqual(self.state.view()["ageSeconds"], 0)
        self.now = 10
        self.state.ingest(snapshot(session="reload-session"))
        self.now = 11
        self.state.ingest(pulse(2, s="reload-session"))
        self.assertEqual(self.state.view()["snapshot"]["profileObservedAt"], 1700000010000)

    def test_low_health_event_captures_the_matching_combat_counter(self):
        self.state.ingest(snapshot())
        self.state.ingest(pulse(2, c=True))
        life = {"v": 1, "kind": "life", "s": "test-session", "g": "Player-1-TEST",
                "l": "test-login", "c": 3, "t": 2}
        self.state.ingest(life)
        self.state.ingest(pulse(3, c=True, h={"id": 1, "percent": 19}))
        self.state.ingest({**life, "c": 4, "t": 3})
        view = self.state.view()
        event = next(event for event in view["events"] if event["type"] == "low_health")
        self.assertEqual((event["snapshot"]["loginId"], event["snapshot"]["combatEnds"]), ("test-login", 3))
        self.assertEqual(view["snapshot"]["combatEnds"], 4)

    def test_compact_pulses_only_notify_once_per_low_health_id_and_death_transition(self):
        self.state.ingest(snapshot())
        self.state.ingest(pulse(c=True))
        health = {"id": 1, "percent": 19}
        self.state.ingest(pulse(3, c=True, h=health))
        self.state.ingest(pulse(4, c=True, h=health))
        self.state.ingest(pulse(5, d=True, h=health))
        self.state.ingest(pulse(6))
        self.state.ingest(pulse(7, c=True, h={"id": 2, "percent": 10}))
        self.assertEqual([event["type"] for event in self.state.view()["events"]],
                         ["connected", "low_health", "death", "low_health"])
        self.assertEqual([event["healthPercent"] for event in self.state.view()["events"]
                          if event["type"] == "low_health"], [19, 10])

    def test_loot_retries_are_deduplicated_and_foreign_profiles_are_ignored(self):
        self.state.ingest(loot())
        self.state.ingest(snapshot())
        self.state.ingest(loot(2, s="foreign"))
        self.state.ingest(loot(3))
        self.state.ingest(loot(1, name=None))
        self.state.ingest(loot(3))
        self.state.ingest(pulse(2, on=False))
        self.state.ingest(loot(4))
        self.state.ingest(pulse(3))
        self.state.ingest(loot(3))
        events = [event for event in self.state.view()["events"] if event["type"] == "loot"]
        self.assertEqual([(event["itemId"], event["itemName"], event["quantity"]) for event in events],
                         [(2589, "亚麻布", 3), (2589, None, 3)])

    def test_frozen_pulses_do_not_renew_live_state(self):
        self.state.ingest(snapshot())
        self.state.ingest(pulse())
        self.now = 6
        self.state.ingest(pulse())
        self.assertEqual(self.state.view()["status"], "stale")
        self.state.ingest(pulse(3))
        self.assertEqual(self.state.view()["status"], "live")

    def test_map_loading_hides_saved_gear_and_inventory_until_online_without_resending(self):
        self.state.ingest(snapshot())
        self.state.ingest(pulse())
        gear = loadout(observedAt=1700000000)
        bag = inventory(observedAt=1700000000)
        for fragment in gear_fragments(gear) + inventory_fragments(bag):
            self.state.ingest(fragment)
        self.assertEqual(self.state.view()["equipmentLoadout"], gear)
        self.assertEqual(self.state.view()["inventory"], bag)
        self.state.ingest(pulse(3, on=False))
        self.assertIsNone(self.state.view()["equipmentLoadout"])
        self.assertIsNone(self.state.view()["inventory"])
        self.now = 20
        self.state.ingest(pulse(4, p=LOCATION))
        current = self.state.view()
        self.assertEqual(current["equipmentLoadout"], gear)
        self.assertEqual(current["inventory"], bag)
        self.assertEqual([event["type"] for event in current["events"]], ["connected", "zone"])

    def test_missing_profile_after_proving_pulses_signals_reload(self):
        reader = self.feed_frames([encode_frame(pulse(tick)) for tick in (1, 2, 3)])
        self.assertTrue(reader.proven)
        self.assertTrue(self.state.view()["needsProfile"])
        self.assertIsNone(self.state.view()["snapshot"])

    def test_crc_recovery_keeps_frozen_gear_across_pulses_for_same_window(self):
        frames = [encode_frame(snapshot(tick=tick)) for tick in (1, 2, 3)]
        frames.append(encode_frame(pulse(4)))
        gear = loadout(observedAt=1700000000)
        parts = gear_fragments(gear)
        frames += [encode_frame(part) for part in parts[:-1]]
        corrupt = bytearray(encode_frame(pulse(5)))
        corrupt[40] ^= 1
        frames.append(bytes(corrupt))
        frames += [encode_frame(pulse(tick)) for tick in (5, 6, 7)]
        frames.append(encode_frame(parts[-1]))
        self.feed_frames(frames)
        self.assertEqual(self.state.view()["equipmentLoadout"], gear)
