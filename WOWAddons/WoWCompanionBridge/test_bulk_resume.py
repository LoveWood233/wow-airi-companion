"""Recover interrupted bulk transfers only after a new proof from the same capture source."""
from __future__ import annotations

import unittest
import copy
import json
import http.client
import struct
import threading
from unittest.mock import patch

from connection import ConnectionReader
from geometry import Image
from protocol import FrameError, decode_frame, encode_frame, pixels_for_frame
from server import BridgeServer, capture_loop
from state import CompanionState
from test_bridge import snapshot
from test_connection import FakeWindows
from test_equipment_loadout import fragments as gear_fragments, loadout
from test_geometry import FakeCapture
from test_inventory import fragments as inventory_fragments, inventory
from test_item_storage import FIXTURE as STORAGE_FIXTURE, fragments as storage_fragments
from test_quests import fragments as quest_fragments, quests
from test_talents import fragments as talent_fragments, talents
from test_life_state import life
from test_weapon_skills import parts as weapon_parts
from test_equipment_offer import offer
from test_equipment_swap import swap, unchecked_frame


def image(message=None, *, corrupt=False, protocol="WCP1", raw_frame=None):
    frame = bytearray(raw_frame if raw_frame is not None else encode_frame(message, protocol))
    if corrupt:
        frame[40] ^= 1
    raw = pixels_for_frame(bytes(frame), 1)
    pixels = bytearray(400 * 300 * 4)
    for row in range(64):
        offset = ((row + 8) * 400 + 8) * 4
        pixels[offset:offset + 256] = raw[row * 256:(row + 1) * 256]
    return Image(bytes(pixels), 400, 300)


class ScriptedStop:
    def __init__(self, frames, capture, state, now):
        self.frames, self.capture, self.state, self.now = frames, capture, state, now
        self.index, self.observations = 0, []

    def is_set(self):
        return self.index >= len(self.frames)

    def wait(self, seconds):
        self.observations.append(self.state.view())
        self.index += 1
        self.now[0] += seconds
        if not self.is_set():
            self.capture.image = self.frames[self.index]


class BulkResumeTests(unittest.TestCase):
    def run_frames(self, frames, *, game="retail"):
        now = [0.0]
        state = CompanionState(game=game, clock=lambda: now[0], wall_clock=lambda: 1700000000 + now[0])
        reader = ConnectionReader(FakeWindows(), game, clock=lambda: now[0])
        capture = FakeCapture(frames[0])
        stop = ScriptedStop(frames, capture, state, now)
        with patch("capture.ScreenCapture", return_value=capture), \
                patch("window.WindowsGameWindows", return_value=reader.windows), \
                patch("connection.ConnectionReader", return_value=reader):
            capture_loop(state, stop)
        return state, reader, stop

    def test_bad_crc_and_three_same_source_heartbeats_keep_gear_prefix(self):
        now = [0.0]
        state = CompanionState(clock=lambda: now[0], wall_clock=lambda: 1700000000 + now[0])
        windows = FakeWindows()
        reader = ConnectionReader(windows, "retail", clock=lambda: now[0])
        record = loadout(observedAt=1700000000)
        parts = gear_fragments(record)
        frames = [image(snapshot(tick=tick)) for tick in (1, 2, 3)]
        frames += [image(part) for part in parts[:-1]]
        frames += [image(snapshot(tick=4), corrupt=True)]
        frames += [image(snapshot(tick=tick)) for tick in (4, 5, 6)]
        frames += [image(parts[-1])]
        capture = FakeCapture(frames[0])
        stop = ScriptedStop(frames, capture, state, now)
        with patch("capture.ScreenCapture", return_value=capture), \
                patch("window.WindowsGameWindows", return_value=windows), \
                patch("connection.ConnectionReader", return_value=reader):
            capture_loop(state, stop)
        self.assertEqual(state.view()["equipmentLoadout"], record)

    def test_ambiguous_pixels_recover_in_both_profiles_after_three_heartbeats(self):
        for game, protocol in [("retail", "WCP1"), ("forever", "WCF1")]:
            with self.subTest(game=game):
                record = loadout(observedAt=1700000000)
                parts = gear_fragments(record)
                frames = [image(snapshot(tick=tick), protocol=protocol) for tick in (1, 2, 3)]
                frames += [image(part, protocol=protocol) for part in parts[:-1]]
                blurred = image(snapshot(tick=4), protocol=protocol)
                raw = bytearray(blurred.pixels)
                offset = ((8 + 10) * 400 + 8 + 10) * 4
                raw[offset:offset + 3] = bytes([128, 128, 128])
                frames.append(Image(bytes(raw), 400, 300))
                frames += [image(snapshot(tick=tick), protocol=protocol) for tick in (4, 5, 6)]
                frames += [image(parts[-1], protocol=protocol)]
                state, _, _ = self.run_frames(frames, game=game)
                self.assertEqual(state.view()["equipmentLoadout"], record)

    def test_unreadable_selected_protocol_magic_recovers_after_three_heartbeats(self):
        for game, protocol in [("retail", "WCP1"), ("forever", "WCF1")]:
            with self.subTest(game=game):
                record = loadout(observedAt=1700000000)
                parts = gear_fragments(record)
                frames = [image(snapshot(tick=tick), protocol=protocol) for tick in (1, 2, 3)]
                frames += [image(part, protocol=protocol) for part in parts[:-1]]
                broken = bytearray(encode_frame(snapshot(tick=4), protocol))
                broken[0] ^= 1
                broken_index = len(frames)
                frames.append(image(raw_frame=bytes(broken)))
                frames += [image(snapshot(tick=tick), protocol=protocol) for tick in (4, 5, 6)]
                frames.append(image(parts[-1], protocol=protocol))
                state, _, stop = self.run_frames(frames, game=game)
                self.assertEqual(stop.observations[broken_index]["snapshot"]["tick"], 3)
                for index in range(broken_index, broken_index + 3):
                    self.assertEqual(stop.observations[index]["status"], "waiting")
                    self.assertIsNone(stop.observations[index]["equipmentLoadout"])
                self.assertEqual(state.view()["equipmentLoadout"], record)

    def test_other_game_protocol_never_preserves_prefix_in_either_profile(self):
        for game, protocol, foreign in [("retail", "WCP1", "WCF1"), ("forever", "WCF1", "WCP1")]:
            with self.subTest(game=game):
                parts = gear_fragments(loadout(observedAt=1700000000))
                frames = [image(snapshot(tick=tick), protocol=protocol) for tick in (1, 2, 3)]
                frames += [image(part, protocol=protocol) for part in parts[:-1]]
                frames.append(image(snapshot(tick=4), protocol=foreign))
                frames += [image(snapshot(tick=tick), protocol=protocol) for tick in (4, 5, 6)]
                frames.append(image(parts[-1], protocol=protocol))
                state, _, _ = self.run_frames(frames, game=game)
                self.assertIsNone(state.view()["equipmentLoadout"])
                self.assertEqual(len(state.loadout_pending[1]["parts"]), 1)

    def test_foreign_protocol_lengths_and_schema_errors_discard_the_old_prefix(self):
        length = bytearray(encode_frame(snapshot(tick=4)))
        struct.pack_into("<H", length, 4, 505)
        for broken in [encode_frame(snapshot(tick=4), "WCF1"), bytes(length),
                       unchecked_frame(snapshot(tick="invalid"))]:
            with self.subTest(header=broken[:8]):
                parts = gear_fragments(loadout(observedAt=1700000000))
                frames = [image(snapshot(tick=tick)) for tick in (1, 2, 3)]
                frames += [image(part) for part in parts[:-1]]
                frames += [image(raw_frame=broken)]
                frames += [image(snapshot(tick=tick)) for tick in (4, 5, 6)]
                frames += [image(parts[-1])]
                state, _, _ = self.run_frames(frames)
                self.assertIsNone(state.view()["equipmentLoadout"])
                self.assertEqual(len(state.loadout_pending[1]["parts"]), 1)

    def test_frozen_recovery_pixels_never_reach_three_heartbeat_proof(self):
        parts = gear_fragments(loadout(observedAt=1700000000))
        frames = [image(snapshot(tick=tick)) for tick in (1, 2, 3)]
        frames += [image(part) for part in parts[:-1]]
        frames += [image(snapshot(tick=4), corrupt=True)]
        frames += [image(snapshot(tick=4))] * 70
        state, reader, _ = self.run_frames(frames)
        self.assertFalse(reader.proven)
        self.assertNotEqual(state.view()["status"], "live")
        self.assertIsNone(state.view()["equipmentLoadout"])
        self.assertFalse(state.loadout_pending)

    def test_unknown_decoder_errors_fail_closed_if_error_text_changes(self):
        with patch("geometry.decode_geometry", side_effect=FrameError("unrecognized decoder error")), \
                patch("geometry.decode_pixels", side_effect=FrameError("unrecognized decoder error")):
            state, reader, _ = self.run_frames([image(snapshot(tick=1))])
        self.assertFalse(reader.transient_error)
        self.assertIsNone(state._bulk_recovery)


class BulkStateResumeTests(unittest.TestCase):
    def setUp(self):
        self.now = 0.0
        self.state = CompanionState(clock=lambda: self.now, wall_clock=lambda: 1700000000 + self.now)
        self.source = ("retail", (11, 22, 33), (8, 8, 1, "WCP1"))
        self.connected = {**self.state.connection, "phase": "connected", "reason": None, "consecutive": 3}
        self.state.report_connection(self.connected, source_token=self.source)
        self.base = snapshot(tick=10, seq=10)
        self.state.ingest(self.base)
        storage = json.loads(STORAGE_FIXTURE.read_bytes())
        storage.update(id=1, session=self.base["session"], guid=self.base["guid"], observedAt=1700000000)
        records = {
            "gear": (loadout(observedAt=1700000000), gear_fragments),
            "inv": (inventory(items=[{"itemID": index + 1, "quantity": 2} for index in range(20)]), inventory_fragments),
            "qlog": (quests(), quest_fragments),
            "traits": (talents(observedAt=1700000000, **{"class": "MAGE", "classID": 8, "specID": 64}), talent_fragments),
            "store": (storage, storage_fragments),
        }
        self.records = {kind: record for kind, (record, _) in records.items()}
        self.parts = {kind: split(record) for kind, (record, split) in records.items()}
        self.assertTrue(all(len(parts) > 1 for parts in self.parts.values()))

    def send(self, part):
        self.state.ingest(decode_frame(encode_frame(part)))

    def pending(self):
        return {"gear": self.state.loadout_pending, "inv": self.state.inventory_pending,
                "qlog": self.state.quests_pending, "traits": self.state.talents_pending,
                "store": self.state.item_storage.pending}

    def seed(self, *, complete=False):
        for parts in self.parts.values():
            for part in parts if complete else parts[:1]:
                self.send(part)

    def loss(self, at=.1, **changes):
        self.now = at
        diagnostic = {**self.connected, "phase": "locating", "reason": "grid-unreadable", "consecutive": 0}
        diagnostic.update(changes)
        self.state.report_connection(diagnostic, source_token=self.source, transient=True)
        self.state.capture_error("CRC 校验失败，等待下一完整帧")

    def recover(self, at=1.0, **changes):
        self.now = at
        self.state.report_connection(self.connected, source_token=self.source)
        self.state.ingest({**self.base, "tick": 13, **changes})

    def test_all_bulk_prefixes_survive_without_changing_timestamps_or_emitting_events(self):
        self.seed()
        pending = copy.deepcopy(self.pending())
        before_events = self.state.event_id
        self.loss()
        self.recover(level=30, seq=11)
        self.assertEqual(self.pending(), pending)
        self.assertEqual(self.state.event_id, before_events)
        for parts in self.parts.values():
            for part in parts[1:]:
                self.send(part)
        current = self.state.view()
        for kind, field in [("gear", "equipmentLoadout"), ("inv", "inventory"), ("qlog", "quests"), ("traits", "talents")]:
            self.assertEqual(current[field], self.records[kind], kind)
        self.assertEqual(self.state.read_item_storage(0)["record"], self.records["store"])

    def test_proving_exposes_no_current_bulk_or_controls_and_rejects_auxiliary_frames(self):
        self.seed(complete=True)
        self.send(life(t=10))
        for part in weapon_parts():
            self.send(part)
        self.send(offer())
        self.send(swap(at=1700000000))
        self.state.macro_import, self.state.macro_import_at = {"q": 1}, 0
        self.state.group_buff, self.state.group_buff_at = {"q": 1}, 0
        self.state.calendar, self.state.calendar_at = {"items": []}, 0
        self.loss()
        original_cursor = self.state.item_storage.sequence
        for phase, consecutive in [("validating", 1), ("validating", 2), ("connected", 3)]:
            self.now += .2
            self.state.report_connection({**self.connected, "phase": phase, "consecutive": consecutive},
                                         source_token=self.source, transient=phase != "connected")
            for parts in self.parts.values():
                self.send(parts[-1])
            current = self.state.view()
            self.assertEqual(current["status"], "waiting")
            for field in ["equipmentLoadout", "inventory", "quests", "talents", "equipmentOffer", "macroImport", "groupBuff", "calendar"]:
                self.assertIsNone(current[field], field)
            self.assertEqual(current["equipmentSwaps"], [])
            self.assertEqual(current["equipmentComparisons"], [])
            self.assertNotIn("loginId", current["snapshot"])
            self.assertNotIn("weaponSkills", current["snapshot"])
            self.assertEqual(self.state.read_item_storage(0), {"cursor": 0, "record": None, "hasMore": False})
            self.assertEqual(self.state.item_storage.sequence, original_cursor)
        self.state.ingest({**self.base, "tick": 13})
        current = self.state.view()
        self.assertEqual(current["equipmentLoadout"], self.records["gear"])
        self.assertNotIn("loginId", current["snapshot"])
        self.assertNotIn("weaponSkills", current["snapshot"])
        for field in ["equipmentOffer", "macroImport", "groupBuff", "calendar"]:
            self.assertIsNone(current[field], field)

    def test_deadline_is_original_heartbeat_time_and_never_slides(self):
        for loss_at, proof_at, retained in [(.1, 4.999, True), (.1, 5.0, True), (.1, 5.001, False), (4, 6, False)]:
            with self.subTest(loss=loss_at, proof=proof_at):
                self.setUp()
                self.seed()
                self.loss(loss_at)
                self.recover(proof_at)
                self.assertEqual(bool(self.state.loadout_pending), retained)
        self.setUp()
        self.seed()
        self.loss(.1)
        self.loss(4.5)
        self.recover(5.1)
        self.assertFalse(any(self.pending().values()))

    def test_account_character_session_offline_old_seq_or_frozen_tick_cannot_resume(self):
        for changes in [{"account": "another-account"}, {"guid": "Player-other"}, {"session": "another-session"},
                        {"online": False}, {"seq": 9}, {"tick": 10}, {"tick": 9}]:
            with self.subTest(changes=changes):
                self.setUp()
                self.seed()
                self.loss()
                self.recover(**changes)
                self.assertFalse(any(self.pending().values()))

    def test_window_process_lifetime_protocol_config_or_missing_token_hard_reset(self):
        for source in [None, ("retail", (12, 22, 33), (8, 8, 1, "WCP1")),
                       ("retail", (11, 23, 33), (8, 8, 1, "WCP1")), ("retail", (11, 22, 34), (8, 8, 1, "WCP1")),
                       ("forever", (11, 22, 33), (8, 8, 1, "WCF1")), ("retail", (11, 22, 33), (8, 8, 2, "WCP1"))]:
            with self.subTest(source=source):
                self.setUp()
                self.seed()
                self.loss()
                self.state.report_connection(self.connected, source_token=source)
                self.state.ingest({**self.base, "tick": 13})
                self.assertFalse(any(self.pending().values()))

    def test_retry_config_round_trip_and_demo_cancel_recovery(self):
        for action in [lambda state: state.retry_connection(),
                       lambda state: (state.update_config({"cellSize": 2}), state.update_config({"cellSize": 1})),
                       lambda state: (state.set_demo(True), state.set_demo(False))]:
            with self.subTest(action=action):
                self.setUp()
                self.seed()
                self.loss()
                action(self.state)
                self.recover()
                self.assertFalse(any(self.pending().values()))

    def test_original_assembly_ttl_and_completed_observation_age_are_not_renewed(self):
        self.seed()
        for pending in self.pending().values():
            for entry in pending.values():
                entry["started"] = -1199.7
        self.loss()
        self.recover(.5)
        for kind in ["gear", "inv", "qlog", "traits"]:
            self.assertFalse(self.pending()[kind], kind)
        self.assertEqual(next(iter(self.state.item_storage.pending.values()))["started"], -1199.7)
        for age in [1199, 3600]:
            with self.subTest(age=age):
                self.setUp()
                self.seed(complete=True)
                self.state.equipment_loadout["observedAt"] = 1700000000 - age
                self.loss()
                self.recover(.5)
                self.assertEqual(self.state.view()["equipmentLoadout"]["observedAt"], 1700000000 - age)

    def test_old_completed_gear_keeps_its_event_driven_session_cache_and_observation_time(self):
        self.records["gear"]["observedAt"] = 1700000000 - 3600
        self.parts["gear"] = gear_fragments(self.records["gear"])
        self.seed(complete=True)
        self.loss()
        self.recover(.5)
        self.assertEqual(self.state.view()["equipmentLoadout"], self.records["gear"])
        for part in self.parts["gear"]:
            self.send(part)
        self.assertEqual(self.state.view()["equipmentLoadout"], self.records["gear"])

    def test_completed_bulk_and_sqlite_publication_keep_original_age_and_cursor(self):
        self.seed(complete=True)
        before = self.state.view()
        stored = self.state.read_item_storage(0)
        self.loss()
        self.recover(.5)
        after = self.state.view()
        for field in ["inventory", "inventoryReceivedAt", "quests", "questsReceivedAt", "talents", "talentsReceivedAt"]:
            self.assertEqual(after[field], before[field], field)
        self.assertEqual(self.state.read_item_storage(0), stored)

    def test_completed_timed_observations_expire_at_their_original_time_after_resume(self):
        for kind, split in [("inv", inventory_fragments), ("qlog", quest_fragments), ("traits", talent_fragments)]:
            self.records[kind]["observedAt"] = 1700000000 - 1199
            self.parts[kind] = split(self.records[kind])
        self.seed(complete=True)
        self.loss()
        self.recover(.5)
        current = self.state.view()
        for field in ["inventory", "quests", "talents"]:
            self.assertIsNotNone(current[field], field)
        self.now = 1.5
        self.state.ingest({**self.base, "tick": 14})
        current = self.state.view()
        for field in ["inventory", "quests", "talents"]:
            self.assertIsNone(current[field], field)

    def test_storage_expiry_discards_held_prefix_without_renewing_its_start_time(self):
        self.seed()
        self.state.item_storage.pending[1]["started"] = -35999.7
        self.loss()
        self.recover(.5)
        self.assertEqual(self.state.item_storage.pending[1]["started"], -35999.7)
        for part in self.parts["store"][1:]:
            self.send(part)
        self.assertIsNone(self.state.read_item_storage(0)["record"])
        self.assertNotIn(1, self.state.item_storage.pending[1]["parts"])

    def test_item_storage_http_hides_records_and_never_advances_cursor_while_proving(self):
        self.seed(complete=True)
        self.loss()
        server = BridgeServer(("127.0.0.1", 0), self.state)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            client = http.client.HTTPConnection("127.0.0.1", server.server_address[1])
            client.request("GET", "/api/item-storage?after=0")
            response = client.getresponse()
            self.assertEqual(response.status, 200)
            result = json.loads(response.read())
            self.assertEqual((result["cursor"], result["record"], result["hasMore"]), (0, None, False))
            client.close()
        finally:
            server.shutdown()
            server.server_close()
            worker.join()

    def test_unknown_diagnostic_error_and_incomplete_proof_fail_closed(self):
        for changes in [{"phase": "blocked", "reason": "heartbeat-stale"}, {"reason": "unexpected-reason"},
                        {"phase": "error", "reason": "calibration-save-failed"}]:
            with self.subTest(changes=changes):
                self.setUp()
                self.seed()
                self.loss(**changes)
                self.recover()
                self.assertFalse(any(self.pending().values()))
        self.setUp()
        self.seed()
        self.loss()
        self.state.report_connection({**self.connected, "reason": "unexpected-reason"}, source_token=self.source)
        self.state.ingest({**self.base, "tick": 13})
        self.assertFalse(any(self.pending().values()))
        self.setUp()
        self.seed()
        self.loss()
        self.state.report_connection({**self.connected, "consecutive": 2}, source_token=self.source)
        self.state.ingest({**self.base, "tick": 13})
        self.assertFalse(any(self.pending().values()))


if __name__ == "__main__":
    unittest.main()
