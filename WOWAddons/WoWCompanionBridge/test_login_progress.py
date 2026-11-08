"""Preserve additive login counters without inferring combat from sampled snapshots."""
import importlib.util
import unittest

from protocol import FrameError, decode_frame, decode_pixels, encode_frame, pixels_for_frame, validate_snapshot
from state import CompanionState
from test_bridge import snapshot
from test_cross_language import ADDON, LuaRuntime


class LoginProgressProtocolTests(unittest.TestCase):
    @unittest.skipUnless(LuaRuntime, "Actual Lua integration requires the existing test-only Lua runtime")
    def test_actual_lua_short_fights_reach_both_decoders_without_sampling_combat(self):
        for addon, game, magic in ((ADDON, "retail", "WCP1"),
                                   (ADDON.parent / "WoWForeverCompanion", "forever", "WCF1")):
            with self.subTest(game=game):
                spec = importlib.util.spec_from_file_location("login_progress_harness", addon / "tests" / "test_addon.py")
                harness = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(harness)
                lua = LuaRuntime(encoding=None, unpack_returned_tuples=True)
                lua.execute(harness.MOCK)
                ns = lua.table()
                loader = lua.eval(b"function(source,name,ns) assert(loadstring(source))(name,ns) end")
                for line in (addon / (addon.name + ".toc")).read_text("utf-8-sig").splitlines():
                    if line.strip().endswith(".lua") and not line.lstrip().startswith("#"):
                        loader((addon / line.strip()).read_bytes(), addon.name.encode(), ns)
                globals_ = lua.globals()
                globals_.Fire(b"ADDON_LOADED", addon.name.encode())
                globals_.Fire(b"PLAYER_ENTERING_WORLD", True, False)
                for _ in range(7):
                    globals_.Fire(b"PLAYER_REGEN_DISABLED")
                    globals_.Fire(b"PLAYER_REGEN_ENABLED")
                frame, _, _ = ns[b"Protocol"][b"Encode"](globals_[(addon.name + "DB").encode()][b"snapshot"])
                decoded = decode_pixels(pixels_for_frame(frame, 1), 64, 64, 1, magic)
                state = CompanionState(game=game)
                state.ingest(decoded)
                life, _ = ns[b"Transfer"][b"LifeFrame"]()
                state.ingest(decode_pixels(pixels_for_frame(life, 1), 64, 64, 1, magic))
                current = state.view()["snapshot"]
                self.assertTrue(current["loginId"])
                self.assertEqual(current["combatEnds"], 7)
                self.assertFalse(current["combat"])
                self.assertEqual([event["type"] for event in state.view()["events"]], ["connected"])

    def test_both_games_preserve_pair_in_the_existing_one_pixel_grid(self):
        for magic in ("WCP1", "WCF1"):
            for count in (0, 7, 2147483647):
                with self.subTest(magic=magic, count=count):
                    value = snapshot(loginId="game-login_1", combatEnds=count)
                    frame = encode_frame(value, magic)
                    self.assertEqual(len(frame), 512)
                    self.assertEqual(decode_pixels(pixels_for_frame(frame, 1), 64, 64, 1, magic), value)

    def test_old_v3_snapshots_leave_the_capability_unknown(self):
        decoded = decode_frame(encode_frame(snapshot()))
        self.assertNotIn("loginId", decoded)
        self.assertNotIn("combatEnds", decoded)

    def test_partial_pairs_are_rejected(self):
        for fields in ({"loginId": "login"}, {"combatEnds": 0}):
            with self.subTest(fields=fields), self.assertRaises(FrameError):
                validate_snapshot(snapshot(**fields))

    def test_invalid_identifiers_are_rejected_before_offline_normalization(self):
        for online in (True, False):
            for login_id in (None, True, 1, "", "x" * 41, "bad id", "登录", []):
                with self.subTest(online=online, login_id=login_id), self.assertRaises(FrameError):
                    validate_snapshot(snapshot(loginId=login_id, combatEnds=0, online=online))

    def test_invalid_counters_are_rejected_before_offline_normalization(self):
        for online in (True, False):
            for count in (None, True, False, -1, 1.5, 2147483648, "5", float("inf"), float("nan")):
                with self.subTest(online=online, count=count), self.assertRaises(FrameError):
                    validate_snapshot(snapshot(loginId="login", combatEnds=count, online=online))

    def test_offline_snapshot_omits_both_fields(self):
        decoded = validate_snapshot(snapshot(loginId="login", combatEnds=7, online=False))
        self.assertNotIn("loginId", decoded)
        self.assertNotIn("combatEnds", decoded)

    def test_stale_or_paused_view_hides_progress_without_rewriting_history(self):
        clock = [10.0]
        state = CompanionState(clock=lambda: clock[0])
        state.ingest(validate_snapshot(snapshot(loginId="login", combatEnds=7)))
        historical = state.view()["events"][0]
        self.assertEqual(state.view()["snapshot"]["combatEnds"], 7)
        clock[0] += 6
        stale = state.view()
        self.assertNotIn("loginId", stale["snapshot"])
        self.assertNotIn("combatEnds", stale["snapshot"])
        self.assertEqual(stale["events"][0], historical)
        state.update_config({"paused": True})
        self.assertNotIn("combatEnds", state.view()["snapshot"])

    def test_bridge_recovery_and_new_bridge_preserve_the_game_counter(self):
        clock = [10.0]
        state = CompanionState(clock=lambda: clock[0])
        state.ingest(validate_snapshot(snapshot(loginId="login", combatEnds=7)))
        clock[0] += 6
        recovered = validate_snapshot(snapshot(loginId="login", combatEnds=9, tick=2, seq=2))
        state.ingest(recovered)
        self.assertEqual(state.view()["snapshot"]["loginId"], "login")
        self.assertEqual(state.view()["snapshot"]["combatEnds"], 9)
        restarted = CompanionState()
        restarted.ingest(recovered)
        self.assertEqual(restarted.view()["snapshot"]["loginId"], "login")
        self.assertEqual(restarted.view()["snapshot"]["combatEnds"], 9)


if __name__ == "__main__":
    unittest.main()
