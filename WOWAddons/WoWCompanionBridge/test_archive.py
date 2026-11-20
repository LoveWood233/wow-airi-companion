"""Bounded character archives remain separate from the live telemetry heartbeat."""

from __future__ import annotations

import base64
import json
import unittest

from protocol import ArchiveError, FrameError, decode_frame, encode_frame, validate_archive
from state import CompanionState
from test_bridge import snapshot
from test_inventory import fragments as inventory_fragments, inventory
from test_item_storage import FIXTURE as STORAGE_FIXTURE, fragments as storage_fragments
from test_pulse import LOCATION, loot, pulse
from test_quests import fragments as quest_fragments, quests
from test_talents import fragments as talent_fragments, talents


NOW = 1700000000
PROGRESS = {"level": 30, "xp": 200, "xpMax": 1000, "copper": "9007199254740991",
            "earned": "21", "spent": "14", "moneyEpoch": "test-epoch", "levelSeconds": 315}
SCHEDULE = {"day": "2026-11-16", "items": [
    {"title": "暗月马戏团", "action": "start", "when": "2026-11-16 09:00"},
    {"title": "公会活动", "action": "personal_end", "when": "2026-11-17 18:00"},
]}


def archive(section="progress", data=None, **changes):
    return {"v": 1, "id": 1, "session": "test-session", "guid": "Player-1-TEST", "observedAt": NOW,
            "section": section, "data": PROGRESS if data is None else data, **changes}


def fragments(record):
    raw = json.dumps(record, separators=(",", ":"), ensure_ascii=False).encode()
    count = (len(raw) + 239) // 240
    return [{"v": 1, "kind": "archive", "s": record["session"], "g": record["guid"], "id": record["id"],
             "p": index + 1, "n": count, "d": base64.b64encode(raw[index * 240:(index + 1) * 240]).decode()}
            for index in range(count)]


class CharacterArchiveTests(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.state = CompanionState(clock=lambda: self.now, wall_clock=lambda: NOW + self.now)
        self.state.ingest(snapshot(**{"class": "WARRIOR", "spec": 72}))

    def send(self, record):
        for part in fragments(record):
            self.state.ingest(part)

    def test_all_archive_sections_validate_and_frames_round_trip_for_both_games(self):
        records = [
            archive(),
            archive("reputation", {"complete": False, "entries": [{"id": 3, "name": "阵营", "rank": 2, "value": -1}]}),
            archive("lockouts", {"complete": True, "entries": [
                {"id": 34, "name": "副本", "difficulty": 8, "resetAt": NOW + 3600, "locked": True, "extended": False},
                {"id": 34, "name": "副本", "difficulty": 9, "resetAt": NOW + 3600, "locked": False, "extended": True},
            ]}),
            archive("schedule", SCHEDULE),
            archive("professions", {"entries": [
                {"id": 164, "name": "锻造", "rank": 30, "maxRank": 300, "recipes": [1, 2], "recipesObservedAt": NOW},
                {"id": 173, "name": "专业", "rank": 0, "maxRank": 75},
            ]}),
            archive("achievements", {"earnedIds": [], "complete": True}),
            archive("exploration", {"maps": [{"mapId": 14, "name": "地图", "areaIds": [47], "overlayCount": 3}]}),
        ]
        for record in records:
            self.assertEqual(validate_archive(record), record)
            for protocol in ("WCP1", "WCF1"):
                for part in fragments(record):
                    with self.subTest(section=record["section"], protocol=protocol):
                        self.assertEqual(decode_frame(encode_frame(part, protocol), protocol), part)
        with self.assertRaises(FrameError):
            encode_frame(pulse(lf=1))
        with self.assertRaises(ArchiveError):
            encode_frame({**fragments(records[0])[0], "n": 1025})

    def test_invalid_or_ambiguous_records_are_rejected(self):
        for record in (
            archive("unknown"), archive("progress", {}), archive("progress", {"copper": "007"}),
            archive("progress", {"copper": "9007199254740992"}), archive("progress", {"level": True}),
            archive("achievements", {"earnedIds": [42, 42], "complete": True}),
            archive("exploration", {"maps": [{"mapId": 1, "name": " ", "areaIds": [1]}]}),
            archive("professions", {"entries": [{"id": 1, "name": "锻造", "rank": 4, "maxRank": 3}]}),
            archive("professions", {"entries": [{"id": 1, "name": "锻造", "rank": 1, "maxRank": 3, "recipes": []}]}),
            archive("lockouts", {"complete": True, "entries": [{"id": 1, "name": "副本", "resetAt": NOW, "locked": 1, "extended": False}]}),
            archive("schedule", {"day": "2026-11-16", "items": [{"title": "活动", "action": "start", "when": "2026-11-17 12:00"}]}),
        ):
            with self.subTest(record=record), self.assertRaises(FrameError):
                validate_archive(record)

    def test_assembly_supersedes_per_section_instead_of_foreign_or_replayed_data(self):
        initial = archive(id=5)
        schedule = archive("schedule", SCHEDULE, id=3)
        schedule_parts = fragments(schedule)
        self.assertGreater(len(schedule_parts), 1)
        for part in reversed(schedule_parts[1:]):
            self.state.ingest(part)
        self.assertIsNone(self.state.view()["calendar"])
        self.send(initial)
        self.assertTrue(self.state.view()["lowFrequency"])
        self.assertEqual(self.state.view()["archive"], {"progress": initial})
        self.state.ingest(schedule_parts[0])
        self.send(archive("progress", {"level": 27}, id=4))
        self.send(archive("progress", {"level": 91}, id=6, session="foreign"))
        self.send(archive("progress", {"level": 99}, id=7, observedAt=NOW + 121))
        self.assertEqual(self.state.view()["archive"], {"progress": initial, "schedule": schedule})
        self.assertEqual(self.state.view()["calendar"], SCHEDULE)
        self.assertEqual(self.state.view()["snapshot"]["level"], 29)
        self.assertEqual([event["type"] for event in self.state.view()["events"]], ["connected"])

        later = archive("progress", {"level": 31}, id=8, observedAt=NOW + 1)
        self.send(later)
        self.send(initial)
        self.assertEqual(self.state.view()["archive"]["progress"], later)

    def test_conflicting_chunks_keep_last_capture_and_do_not_refresh_heartbeat(self):
        self.send(archive())
        parts = fragments(archive("schedule", SCHEDULE, id=2))
        self.state.ingest(parts[0])
        conflict = {**parts[0], "d": base64.b64encode(b"0" * 240).decode()}
        self.state.ingest(conflict)
        for part in parts:
            self.state.ingest(part)
        view = self.state.view()
        self.assertNotIn("schedule", view["archive"])
        self.assertIn("冲突", view["archiveError"])
        self.assertEqual(view["archive"]["progress"], archive())
        self.now = 6
        self.send(archive(id=3))
        self.assertEqual(self.state.view()["status"], "stale")
        self.assertEqual(self.state.view()["archive"], {})

    def test_bank_and_partial_archive_remain_bound_to_same_game_source_through_map_load(self):
        self.state.ingest(pulse(2, lf=True))
        bank = json.loads(STORAGE_FIXTURE.read_bytes())
        bank.update(scope="bank", session="test-session", guid="Player-1-TEST", observedAt=NOW)
        for part in storage_fragments(bank):
            self.state.ingest(part)
        self.assertEqual(self.state.read_item_storage(0)["record"], bank)

        section = archive("schedule", SCHEDULE)
        parts = fragments(section)
        self.state.ingest(parts[0])
        self.state.ingest(pulse(3, on=False))
        self.assertIsNone(self.state.read_item_storage(0)["record"])
        self.now = 10
        self.state.ingest(pulse(4))
        self.assertEqual(self.state.read_item_storage(0)["record"], bank)
        for part in parts[1:]:
            self.state.ingest(part)
        self.assertEqual(self.state.view()["archive"]["schedule"], section)
        self.state.ingest(pulse(5, g="Player-1-OTHER"))
        self.assertIsNone(self.state.read_item_storage(0)["record"])

    def test_same_login_after_map_load_preserves_low_frequency_data_and_immediate_events(self):
        self.state.ingest(pulse(2, lf=True))
        self.send(archive("schedule", SCHEDULE))
        bag, query, traits = inventory(), quests(), talents()
        for part in inventory_fragments(bag) + quest_fragments(query) + talent_fragments(traits):
            self.state.ingest(part)
        self.assertEqual(self.state.view()["talents"], traits)
        self.state.ingest(pulse(3, on=False))
        self.assertEqual(self.state.view()["archive"], {})
        self.assertIsNone(self.state.view()["calendar"])

        self.now = 2400
        self.state.ingest(pulse(4, p=LOCATION, c=True, h={"id": 1, "percent": 17}))
        self.state.ingest(loot())
        self.state.ingest(pulse(5, d=True))
        view = self.state.view()
        self.assertEqual(view["calendar"], SCHEDULE)
        self.assertEqual((view["inventory"], view["quests"], view["talents"]), (bag, query, traits))
        self.assertEqual([event["type"] for event in view["events"]], ["connected", "zone", "low_health", "loot", "death"])

        self.state.ingest(snapshot(session="reload-session"))
        self.state.ingest(pulse(2, s="reload-session", lf=True))
        self.assertEqual(self.state.view()["archive"], {})
        self.assertIsNone(self.state.view()["calendar"])
        self.assertIsNone(self.state.view()["talents"])


if __name__ == "__main__":
    unittest.main()
