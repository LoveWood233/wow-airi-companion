"""Count real combat event transitions across login, reload and short telemetry gaps."""
import json
import unittest

import test_addon


class LoginProgressTest(unittest.TestCase):
    def load(self, saved=None, flags=(True, False), guid=b"Player-1-00000001"):
        self.loads = getattr(self, "loads", 0) + 1
        self.lua = test_addon.LuaRuntime(encoding=None, unpack_returned_tuples=True)
        self.lua.execute(test_addon.MOCK)
        self.lua.execute(("function GetTime() return " + str(12.5 + self.loads) + " end").encode())
        self.g = self.lua.globals()
        self.g.Model[b"guid"] = guid
        root = test_addon.ROOT
        self.database = (root.name + "DB").encode()
        if saved is not None:
            db = self.lua.table()
            db[b"loginProgress"] = self.lua.table_from(saved)
            self.g[self.database] = db
        self.ns = self.lua.table()
        loader = self.lua.eval(b"function(source,name,ns) assert(loadstring(source))(name,ns) end")
        for line in (root / (root.name + ".toc")).read_text("utf-8-sig").splitlines():
            if line.strip().endswith(".lua") and not line.lstrip().startswith("#"):
                loader((root / line.strip()).read_bytes(), root.name.encode(), self.ns)
        self.g.Fire(b"ADDON_LOADED", root.name.encode())
        self.g.Fire(b"PLAYER_ENTERING_WORLD", *flags)

    def snapshot(self):
        value = json.loads(self.g[self.database][b"snapshotJSON"])
        life = self.ns[b"Transfer"][b"LifeFrame"]()
        if life is not None:
            _, payload = life
            progress = json.loads(payload)
            value.update(loginId=progress["l"], combatEnds=progress["c"])
        return value

    def saved(self):
        return dict(self.g[self.database][b"loginProgress"].items())

    def fight(self):
        self.g.Fire(b"PLAYER_REGEN_DISABLED")
        self.g.Fire(b"PLAYER_REGEN_ENABLED")

    def test_initial_login_starts_zero_and_short_fights_between_heartbeats_survive(self):
        self.load()
        first = self.snapshot()
        self.assertTrue(first["loginId"])
        self.assertEqual(first["combatEnds"], 0)
        for _ in range(7):
            self.fight()
        after = self.snapshot()
        self.assertEqual(after["loginId"], first["loginId"])
        self.assertEqual(after["combatEnds"], 7)
        self.assertFalse(after["combat"])
        self.g.Heartbeat()
        self.assertEqual(self.snapshot()["combatEnds"], 7)

    def test_duplicate_or_unpaired_end_events_do_not_count(self):
        self.load()
        self.g.Fire(b"PLAYER_REGEN_ENABLED")
        self.assertEqual(self.snapshot()["combatEnds"], 0)
        self.g.Fire(b"PLAYER_REGEN_DISABLED")
        self.g.Fire(b"PLAYER_REGEN_DISABLED")
        self.g.Fire(b"PLAYER_REGEN_ENABLED")
        self.g.Fire(b"PLAYER_REGEN_ENABLED")
        self.assertEqual(self.snapshot()["combatEnds"], 1)

    def test_reload_keeps_login_and_count_when_transport_session_changes(self):
        self.load()
        for _ in range(3):
            self.fight()
        before = self.snapshot()
        saved = self.saved()
        self.load(saved, flags=(False, True))
        after = self.snapshot()
        self.assertNotEqual(after["session"], before["session"])
        self.assertEqual(after["loginId"], before["loginId"])
        self.assertEqual(after["combatEnds"], 3)
        self.fight()
        self.assertEqual(self.snapshot()["combatEnds"], 4)

    def test_an_observed_start_can_finish_once_after_reload(self):
        self.load()
        self.g.Fire(b"PLAYER_REGEN_DISABLED")
        self.load(self.saved(), flags=(False, True))
        self.g.Fire(b"PLAYER_REGEN_ENABLED")
        self.g.Fire(b"PLAYER_REGEN_ENABLED")
        self.assertEqual(self.snapshot()["combatEnds"], 1)

    def test_new_game_login_replaces_saved_identity_and_resets_count(self):
        self.load()
        self.fight()
        before = self.snapshot()
        self.load(self.saved(), flags=(True, False))
        after = self.snapshot()
        self.assertNotEqual(after["loginId"], before["loginId"])
        self.assertEqual(after["combatEnds"], 0)

    def test_world_transfer_keeps_progress_but_offline_frames_omit_it(self):
        self.load()
        self.fight()
        before = self.snapshot()
        self.g.Fire(b"PLAYER_LEAVING_WORLD")
        offline = self.snapshot()
        self.assertNotIn("loginId", offline)
        self.assertNotIn("combatEnds", offline)
        self.g.Fire(b"PLAYER_ENTERING_WORLD", False, False)
        after = self.snapshot()
        self.assertEqual(after["loginId"], before["loginId"])
        self.assertEqual(after["combatEnds"], 1)

    def test_absent_or_secret_login_flags_never_invent_a_login(self):
        self.load(flags=())
        self.fight()
        self.assertNotIn("loginId", self.snapshot())
        self.assertNotIn("combatEnds", self.snapshot())
        self.g.Fire(b"PLAYER_ENTERING_WORLD", self.g.Secret, False)
        self.assertNotIn("loginId", self.snapshot())
        self.g.Fire(b"PLAYER_ENTERING_WORLD", True, True)
        self.assertNotIn("loginId", self.snapshot())

    def test_reload_without_a_matching_saved_login_stays_unknown(self):
        for saved in [None, {b"guid": b"Other", b"id": b"known", b"count": 8, b"armed": False},
                      {b"guid": b"Player-1-00000001", b"id": b"known", b"count": -1, b"armed": False}]:
            with self.subTest(saved=saved):
                self.load(saved, flags=(False, True))
                self.fight()
                self.assertNotIn("loginId", self.snapshot())
                self.assertNotIn("combatEnds", self.snapshot())

    def test_protocol_omits_invalid_or_partial_pairs_atomically(self):
        self.load()
        source = self.g[self.database][b"snapshot"]
        for login_id, count in [(b"", 1), (b"x" * 41, 1), (b"bad id", 1), (b"valid", -1),
                                (b"valid", 1.5), (b"valid", True), (b"valid", 2147483648),
                                (b"valid", self.g.Secret), (self.g.Secret, 2), (None, 2), (b"valid", None)]:
            with self.subTest(login_id=type(login_id).__name__, count=type(count).__name__):
                source[b"loginId"], source[b"combatEnds"] = login_id, count
                frame, payload, _ = self.ns[b"Protocol"][b"Encode"](source)
                decoded = json.loads(payload)
                self.assertEqual(len(frame), 512)
                self.assertNotIn("loginId", decoded)
                self.assertNotIn("combatEnds", decoded)
                self.assertIsNone(self.ns[b"Protocol"][b"EncodeLife"](source))

    def test_frame_budget_keeps_life_outside_existing_snapshot_fields(self):
        self.load()
        source = self.g[self.database][b"snapshot"]
        source[b"guid"] = b"G" * 48
        source[b"loginId"], source[b"combatEnds"] = None, None
        found = False
        for size in range(97):
            source[b"zone"] = b"Z" * size
            baseline_frame, baseline_payload, baseline = self.ns[b"Protocol"][b"Encode"](source)
            baseline[b"loginId"], baseline[b"combatEnds"] = b"L" * 40, 2147483647
            raw = self.ns[b"Protocol"][b"JSON"](baseline)
            if len(raw) <= 504:
                continue
            frame, payload, clean = self.ns[b"Protocol"][b"Encode"](baseline)
            self.assertEqual(len(frame), 512)
            self.assertLessEqual(len(payload), 504)
            self.assertEqual(payload, baseline_payload)
            self.assertIsNone(clean[b"loginId"])
            self.assertIsNone(clean[b"combatEnds"])
            self.assertIsNotNone(baseline_frame)
            life, life_payload = self.ns[b"Protocol"][b"EncodeLife"](baseline)
            self.assertEqual(len(life), 512)
            self.assertLessEqual(len(life_payload), 220)
            self.assertEqual(json.loads(life_payload)["c"], 2147483647)
            found = True
            break
        self.assertTrue(found, "Fixture must exercise the fixed 504-byte capacity boundary")


if __name__ == "__main__":
    unittest.main()
