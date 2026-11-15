"""Weapon-skill wire bounds and atomic live-session observations."""
from __future__ import annotations

import copy
import binascii
import json
import struct
import unittest
from pathlib import Path

from geometry import AdaptiveCaptureReader, Image
from protocol import WeaponSkillError, decode_frame, encode_frame, pixels_for_frame, validate_weapon_skill
from state import CompanionState
from test_bridge import snapshot
from test_geometry import FakeCapture


def skill(**changes):
    entry = {"skillLineID": 43, "name": "单手剑", "rank": 123, "maxRank": 300, "modifier": 5, "temporary": 0}
    entry.update(changes)
    return entry


def parts(entries=None, **changes):
    entries = [skill()] if entries is None else entries
    base = {"v": 1, "kind": "wskill", "s": "test-session", "g": "Player-1-TEST", "id": 1,
            "t": 1700000000, "status": "available", "n": max(1, len(entries))}
    base.update(changes)
    return [{**base, "p": index + 1, "entry": copy.deepcopy(entry)}
            for index, entry in enumerate(entries or [None])]


class WeaponSkillProtocolTests(unittest.TestCase):
    def test_both_real_lua_streams_publish_the_exact_observation(self):
        root = Path(__file__).resolve().parent.parent
        for game, addon, protocol in (("retail", "WoWMapCompanion", "WCP1"),
                                      ("forever", "WoWForeverCompanion", "WCF1")):
            with self.subTest(game=game):
                folder = root / addon / "tests/fixtures"
                expected = json.loads((folder / f"lua-{game}-weapon-skills.json").read_bytes())
                stream = (folder / f"lua-{game}-weapon-skills.bin").read_bytes()
                state = CompanionState(clock=lambda: 0, wall_clock=lambda: expected["observedAt"], game=game)
                state.ingest(snapshot(session=expected["session"], guid=expected["guid"]))
                self.assertEqual(len(stream) % 512, 0)
                for offset in range(0, len(stream), 512):
                    state.ingest(decode_frame(stream[offset:offset + 512], protocol))
                self.assertEqual(state.view()["snapshot"]["weaponSkills"], expected)

    def test_both_game_grids_round_trip_real_values_and_signed_bonuses(self):
        value = parts([skill(modifier=-5, temporary=10)])[0]
        for protocol in ("WCP1", "WCF1"):
            with self.subTest(protocol=protocol):
                frame = encode_frame(value, protocol)
                self.assertEqual(len(frame), 512)
                self.assertEqual(decode_frame(frame, protocol), value)

    def test_worst_case_valid_frame_fits_the_existing_grid(self):
        value = parts([skill(skillLineID=2147483647, name='"' * 64, rank=65535, maxRank=65535,
                             modifier=-65535, temporary=-65535)], s="s" * 40, g="g" * 48,
                      id=2147483647, t=2147483647, n=32)[0]
        self.assertEqual(decode_frame(encode_frame(value)), value)

    def test_explicit_empty_statuses_are_distinct(self):
        for status in ("available", "unsupported", "unavailable"):
            value = parts([], status=status)[0]
            self.assertEqual(validate_weapon_skill(value)["status"], status)
            self.assertIsNone(validate_weapon_skill(value)["entry"])

    def test_bad_skill_data_keeps_learned_grid_geometry_and_does_not_start_relocation(self):
        reader = AdaptiveCaptureReader()
        config = {"x": 0, "y": 0, "cellSize": 2, "pollMs": 100, "paused": False}
        capture = FakeCapture(Image(pixels_for_frame(encode_frame(snapshot()), 1), 64, 64))
        reader.read(capture, config, "WCP1")
        learned = reader.geometry
        self.assertIsNotNone(learned)
        value = parts([skill(rank=-1)])[0]
        payload = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
        malformed = (b"WCP1" + struct.pack("<HH", len(payload), binascii.crc_hqx(payload, 0xFFFF)) + payload).ljust(512, b"\0")
        capture.image = Image(pixels_for_frame(malformed, 1), 64, 64)
        with self.assertRaises(WeaponSkillError):
            reader.read(capture, config, "WCP1")
        self.assertIs(reader.geometry, learned)
        self.assertEqual(reader.searches, 0)
        capture.image = Image(pixels_for_frame(encode_frame(snapshot(tick=2)), 1), 64, 64)
        self.assertEqual(reader.read(capture, config, "WCP1")["tick"], 2)

    def test_invalid_identity_shape_status_timestamp_and_counts_are_stream_errors(self):
        mutations = [
            {"v": True}, {"kind": "traits"}, {"s": ""}, {"g": ""}, {"s": "bad space"},
            {"s": "s" * 41}, {"g": "g" * 49}, {"id": 0}, {"id": True}, {"t": 0},
            {"t": 2147483648}, {"p": 0}, {"n": 33}, {"p": 2}, {"n": False},
            {"status": "estimated"}, {"status": []}, {"status": "unsupported"}, {"unknown": 1},
        ]
        for changes in mutations:
            with self.subTest(changes=changes), self.assertRaises(WeaponSkillError):
                validate_weapon_skill({**parts()[0], **changes})
        for key in parts()[0]:
            value = parts()[0]
            del value[key]
            with self.subTest(missing=key), self.assertRaises(WeaponSkillError):
                validate_weapon_skill(value)
        with self.assertRaises(WeaponSkillError):
            validate_weapon_skill({**parts([])[0], "n": 2})

    def test_invalid_entries_are_rejected_without_normalizing_or_guessing_ranks(self):
        invalid = [
            {"skillLineID": 0}, {"skillLineID": True}, {"name": ""}, {"name": "界" * 22},
            {"name": "剑\n"}, {"name": "剑\x7f"}, {"name": "剑\x85"}, {"name": "\ud800"},
            {"rank": -1}, {"rank": 301}, {"rank": True}, {"maxRank": 65536},
            {"modifier": -65536}, {"temporary": 1.5}, {"extra": 1},
        ]
        for changes in invalid:
            with self.subTest(changes=changes), self.assertRaises(WeaponSkillError):
                validate_weapon_skill(parts([skill(**changes)])[0])


class WeaponSkillStateTests(unittest.TestCase):
    def setUp(self):
        self.now = [0.0]
        self.state = CompanionState(clock=lambda: self.now[0], wall_clock=lambda: 1700000000 + self.now[0])
        self.state.ingest(snapshot())

    def send(self, entries=None, **changes):
        for part in parts(entries, **changes):
            self.state.ingest(part)

    def current(self):
        return self.state.view()["snapshot"].get("weaponSkills")

    def heartbeat(self, instant, **changes):
        self.now[0] = instant
        self.state.ingest(snapshot(tick=int(instant) + 2, seq=int(instant) + 2, **changes))

    def test_out_of_order_parts_publish_only_a_complete_immutable_snapshot(self):
        values = parts([skill(), skill(skillLineID=44, name="斧", rank=50)])
        self.state.ingest(values[1])
        self.assertIsNone(self.current())
        self.state.ingest(values[0])
        record = self.current()
        self.assertEqual(record, {"v": 1, "id": 1, "session": "test-session", "guid": "Player-1-TEST",
                                  "observedAt": 1700000000, "status": "available", "entries": [value["entry"] for value in values]})
        record["entries"][0]["rank"] = 0
        self.assertEqual(self.current()["entries"][0]["rank"], 123)
        self.assertNotIn("weaponSkills", self.state.snapshot)
        self.assertNotIn("weaponSkills", self.state.events[0]["snapshot"])

    def test_newer_partial_keeps_previous_complete_observation(self):
        self.send()
        values = parts([skill(rank=124), skill(skillLineID=44)], id=2)
        self.state.ingest(values[1])
        self.assertEqual(self.current()["id"], 1)
        self.state.ingest(values[0])
        self.assertEqual(self.current()["id"], 2)
        self.send()
        self.assertEqual(self.current()["id"], 2)

    def test_replays_never_renew_observation_age_or_character_heartbeat(self):
        self.send()
        published = self.state.weapon_skills_at
        for instant in range(4, 125, 4):
            self.heartbeat(instant)
            self.send()
        self.assertEqual(self.state.weapon_skills_at, published)
        self.assertIsNone(self.current())
        self.assertEqual(self.state.view()["status"], "live")
        fresh_at = self.state.fresh_at
        self.now[0] = 130
        self.send(id=2, t=1700000130)
        self.assertEqual(self.state.fresh_at, fresh_at)
        self.assertIsNone(self.current())

    def test_pending_count_is_bounded_and_evicted_revisions_do_not_restart(self):
        for identifier in range(1, 12):
            self.state.ingest(parts([skill(), skill(skillLineID=44)], id=identifier)[0])
            self.assertLessEqual(len(self.state.weapon_skills_pending), 2)
        self.assertNotIn(1, self.state.weapon_skills_pending)
        for value in parts([skill(), skill(skillLineID=44)]):
            self.state.ingest(value)
        self.assertIsNone(self.current())
        self.assertNotIn(1, self.state.weapon_skills_pending)

    def test_timed_out_parts_cannot_complete_or_restart_the_old_revision(self):
        values = parts([skill(), skill(skillLineID=44)])
        self.state.ingest(values[0])
        for instant in range(4, 121, 4):
            self.heartbeat(instant)
        self.assertIsNone(self.current())
        self.assertEqual(self.state.weapon_skills_pending, {})
        for part in reversed(values):
            self.state.ingest(part)
        self.assertIsNone(self.current())
        self.assertEqual(self.state.weapon_skills_pending, {})

    def test_conflicting_pending_metadata_and_duplicate_skills_retire_whole_revisions(self):
        self.send()
        first = parts([skill(), skill(skillLineID=44)], id=2)[0]
        self.state.ingest(first)
        self.state.ingest({**first, "t": 1700000001})
        self.send([skill(), skill(skillLineID=44)], id=2)
        self.assertEqual(self.current()["id"], 1)
        self.send([skill(), skill()], id=3)
        self.assertEqual(self.current()["id"], 1)
        self.send(id=4)
        self.assertEqual(self.current()["id"], 4)

    def test_conflicting_accepted_part_discards_the_completed_revision_without_revival(self):
        self.send()
        self.send([skill(rank=124)])
        self.assertIsNone(self.current())
        self.send()
        self.assertIsNone(self.current())
        self.send(id=2)
        self.assertEqual(self.current()["id"], 2)

    def test_expired_and_future_timestamps_never_replace_current_values(self):
        self.send()
        self.send(id=2, t=1699999879)
        self.send(id=3, t=1700000121)
        self.assertEqual(self.current()["id"], 1)
        self.send(id=4)
        self.assertEqual(self.current()["id"], 4)

    def test_wrong_session_and_character_are_ignored_without_poisoning_the_heartbeat(self):
        self.send(g="Player-2-OTHER")
        self.send(s="other-session")
        self.assertIsNone(self.current())
        self.assertEqual(self.state.view()["status"], "live")
        self.assertIsNone(self.state.error)
        self.send()
        self.assertIsNotNone(self.current())
        self.heartbeat(1, guid="Player-2-OTHER")
        self.assertIsNone(self.current())
        self.send()
        self.assertIsNone(self.current())
        self.send(g="Player-2-OTHER")
        self.assertIsNotNone(self.current())

    def test_unavailable_unsupported_and_complete_empty_observations_clear_entries(self):
        self.send()
        for identifier, status in enumerate(("unavailable", "unsupported", "available"), 2):
            self.send([], id=identifier, status=status)
            self.assertEqual(self.current()["status"], status)
            self.assertEqual(self.current()["entries"], [])

    def test_paused_offline_demo_and_prelogin_never_supply_current_skills(self):
        for transition in (lambda: self.state.update_config({"paused": True}),
                           lambda: self.heartbeat(1, online=False), lambda: self.state.set_demo(True)):
            self.setUp()
            self.send()
            transition()
            self.send(id=2)
            current = self.state.view()["snapshot"]
            self.assertTrue(current is None or "weaponSkills" not in current)
        empty = CompanionState(clock=lambda: 0, wall_clock=lambda: 1700000000)
        empty.ingest(parts()[0])
        self.assertIsNone(empty.view()["snapshot"])

    def test_retry_connection_requires_new_revision_and_observation_after_reset(self):
        self.send()
        self.heartbeat(2)
        self.state.retry_connection()
        self.assertIsNone(self.current())
        self.heartbeat(3)
        self.send()
        self.send(id=9, t=1700000001)
        self.assertIsNone(self.current())
        self.send(id=10, t=1700000003)
        self.assertEqual(self.current()["id"], 10)

    def test_capture_reconnect_clears_previous_complete_values(self):
        self.send()
        self.heartbeat(1)
        self.state.report_connection({"phase": "locating"})
        self.assertIsNone(self.current())
        self.heartbeat(2)
        self.send()
        self.assertIsNone(self.current())
        self.send(id=2, t=1700000002)
        self.assertEqual(self.current()["id"], 2)

    def test_same_session_stale_recovery_cannot_revive_cached_or_unseen_old_parts(self):
        self.send()
        self.now[0] = 7
        self.assertIsNone(self.current())
        self.heartbeat(7)
        self.send()
        self.send(id=2)
        self.assertIsNone(self.current())
        self.heartbeat(8)
        self.send(id=3, t=1700000008)
        self.assertEqual(self.current()["id"], 3)

    def test_bad_weapon_skill_part_does_not_poison_the_character_or_previous_complete_capture(self):
        self.send()
        self.state.ingest({**parts(id=2)[0], "entry": skill(rank=-1)})
        self.state.capture_weapon_skills_error("invalid weapon-skill frame")
        self.assertEqual(self.current()["id"], 1)
        self.assertEqual(self.state.view()["status"], "live")
        self.assertIsNone(self.state.error)


if __name__ == "__main__":
    unittest.main()
