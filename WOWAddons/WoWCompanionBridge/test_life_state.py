"""Life telemetry enriches only fresh, matching game observations without replaying capability."""
import copy
import unittest

from protocol import FrameError
from state import CompanionState
from test_bridge import snapshot


def life(**changes):
    value = {"v": 1, "kind": "life", "s": "test-session", "g": "Player-1-TEST",
             "l": "real-game-login", "c": 5, "t": 10}
    value.update(changes)
    return value


class LifeStateTests(unittest.TestCase):
    def setUp(self):
        self.now = 10.0
        self.state = CompanionState(clock=lambda: self.now)
        self.base = snapshot(tick=10, seq=10)
        self.state.ingest(self.base)

    def progress(self):
        current = self.state.view()["snapshot"] or {}
        return current.get("loginId"), current.get("combatEnds")

    def base_frame(self, **changes):
        self.base = self.base | changes
        self.state.ingest(self.base)

    def test_both_game_profiles_merge_a_pair_without_mutating_base_or_events(self):
        for game in ("retail", "forever"):
            with self.subTest(game=game):
                state = CompanionState(game=game, clock=lambda: self.now)
                state.ingest(self.base)
                before = state.view()
                original = copy.deepcopy(state.snapshot)
                state.ingest(life())
                current = state.view()
                self.assertEqual((current["snapshot"]["loginId"], current["snapshot"]["combatEnds"]),
                                 ("real-game-login", 5))
                self.assertEqual(state.snapshot, original)
                for key in ("events", "eventCursor", "lastSeen", "ageSeconds", "connection"):
                    self.assertEqual(current[key], before[key])

    def test_same_count_with_a_new_tick_renews_only_the_life_ttl(self):
        self.state.ingest(life())
        self.now += 4
        self.base_frame(tick=11)
        self.state.ingest(life(t=11))
        self.now += 4
        self.base_frame(tick=12)
        self.assertEqual(self.progress(), ("real-game-login", 5))

    def test_duplicate_or_older_ticks_do_not_extend_life_ttl(self):
        for late in (life(), life(t=9), life(t=10, c=8)):
            with self.subTest(late=late):
                self.setUp()
                self.state.ingest(life())
                self.now += 4
                self.base_frame(tick=11)
                self.state.ingest(late)
                self.now += 1
                self.assertEqual(self.progress(), ("real-game-login", 5))
                self.now += .01
                self.assertEqual(self.progress(), (None, None))

    def test_expired_life_does_not_fall_back_to_an_inline_pair(self):
        self.base_frame(loginId="real-game-login", combatEnds=5)
        self.state.ingest(life())
        self.now += 5.01
        self.base_frame(tick=11)
        self.assertEqual(self.progress(), (None, None))
        self.state.ingest(life())
        self.assertEqual(self.progress(), (None, None))
        self.state.ingest(life(t=11, c=6))
        self.assertEqual(self.progress(), ("real-game-login", 6))

    def test_life_cannot_refresh_a_stale_base_even_with_new_ticks(self):
        self.state.ingest(life())
        before = self.state.last_seen
        self.now += 6
        self.state.ingest(life(t=11, c=6))
        self.assertEqual(self.state.view()["status"], "stale")
        self.assertEqual(self.state.last_seen, before)
        self.assertEqual(self.progress(), (None, None))
        self.base_frame(tick=11)
        self.state.ingest(life())
        self.assertEqual(self.progress(), (None, None))
        self.state.ingest(life(t=11, c=6))
        self.assertEqual(self.progress(), ("real-game-login", 6))

    def test_count_cannot_decrease_or_poison_a_later_valid_frame(self):
        self.state.ingest(life())
        self.base_frame(tick=11)
        self.state.ingest(life(t=11, c=4))
        self.assertEqual(self.progress(), ("real-game-login", 5))
        self.state.ingest(life(t=11, c=6))
        self.assertEqual(self.progress(), ("real-game-login", 6))

    def test_same_transport_login_change_revokes_the_pair_but_keeps_its_watermark(self):
        self.state.ingest(life())
        self.base_frame(tick=11)
        self.state.ingest(life(t=11, l="different-login", c=20))
        self.assertEqual(self.progress(), (None, None))
        self.state.ingest(life())
        self.assertEqual(self.progress(), (None, None))
        self.state.ingest(life(t=11, c=6))
        self.assertEqual(self.progress(), ("real-game-login", 6))

    def test_current_inline_login_conflict_cannot_be_overwritten_by_old_life(self):
        self.state.ingest(life())
        self.base_frame(tick=11, loginId="different-login", combatEnds=0)
        self.state.ingest(life(t=11))
        self.assertEqual(self.progress(), (None, None))

    def test_inline_pair_is_a_counter_floor_before_and_after_life_adoption(self):
        self.base_frame(loginId="real-game-login", combatEnds=7)
        self.state.ingest(life(c=6))
        self.assertEqual(self.progress(), (None, None))
        self.state.ingest(life(c=7))
        self.assertEqual(self.progress(), ("real-game-login", 7))
        self.base_frame(tick=11, combatEnds=9)
        self.state.ingest(life(t=11, c=8))
        self.assertEqual(self.progress(), ("real-game-login", 9))
        self.state.ingest(life(t=11, c=9))
        self.assertEqual(self.progress(), ("real-game-login", 9))

    def test_invalid_scope_or_tick_window_does_not_adopt_life(self):
        for changes in ({"s": "other-session"}, {"g": "Player-2-OTHER"}, {"t": 4}, {"t": 12}):
            with self.subTest(changes=changes):
                self.setUp()
                self.state.ingest(life(**changes))
                self.assertEqual(self.progress(), (None, None))
                self.assertFalse(self.state.life_managed)
        for tick in (5, 11):
            with self.subTest(boundary_tick=tick):
                self.setUp()
                self.state.ingest(life(t=tick))
                self.assertEqual(self.progress(), ("real-game-login", 5))

    def test_auxiliary_frame_before_a_base_is_not_buffered(self):
        state = CompanionState(clock=lambda: self.now)
        state.ingest(life())
        state.ingest(self.base)
        self.assertNotIn("loginId", state.view()["snapshot"])

    def test_identity_switch_clears_exposure_and_allows_a_new_life_watermark(self):
        for changes, life_changes in (({"guid": "Player-2-OTHER"}, {"g": "Player-2-OTHER"}),
                                      ({"session": "new-session"}, {"s": "new-session"}),
                                      ({"account": "new-account"}, {})):
            with self.subTest(changes=changes):
                self.setUp()
                self.state.ingest(life())
                self.base_frame(**changes, seq=1, tick=1)
                self.assertEqual(self.progress(), (None, None))
                self.state.ingest(life(**life_changes, l="new-login", c=0, t=1))
                self.assertEqual(self.progress(), ("new-login", 0))

    def test_offline_revokes_exposure_and_reentry_needs_a_new_life_tick(self):
        self.state.ingest(life())
        self.base_frame(online=False, tick=11, seq=11)
        self.state.ingest(life(t=11, c=6))
        self.assertEqual(self.progress(), (None, None))
        self.base_frame(online=True, tick=12, seq=12)
        self.assertEqual(self.progress(), (None, None))
        self.state.ingest(life())
        self.assertEqual(self.progress(), (None, None))
        self.state.ingest(life(t=12, c=6))
        self.assertEqual(self.progress(), ("real-game-login", 6))

    def test_error_or_disconnect_revokes_without_renewing_on_base_recovery(self):
        for action in (lambda: self.state.capture_error("test capture error"),
                       lambda: self.state.retry_connection(),
                       lambda: self.state.report_connection({"phase": "locating"})):
            with self.subTest(action=action):
                self.setUp()
                self.state.ingest(life())
                action()
                self.state.ingest(life(t=11, c=6))
                self.assertEqual(self.progress(), (None, None))
                self.base_frame(tick=11)
                self.assertEqual(self.progress(), (None, None))
                self.state.ingest(life())
                self.assertEqual(self.progress(), (None, None))
                self.state.ingest(life(t=11, c=6))
                self.assertEqual(self.progress(), ("real-game-login", 6))

    def test_pause_resume_retains_the_watermark(self):
        self.state.ingest(life())
        self.state.update_config({"paused": True})
        self.state.ingest(life(t=11, c=6))
        self.assertEqual(self.progress(), (None, None))
        self.state.update_config({"paused": False})
        self.base_frame(tick=11)
        self.state.ingest(life())
        self.assertEqual(self.progress(), (None, None))
        self.state.ingest(life(t=11, c=6))
        self.assertEqual(self.progress(), ("real-game-login", 6))

    def test_demo_roundtrip_needs_new_real_evidence_and_retains_the_watermark(self):
        self.state.ingest(life())
        self.state.set_demo(True)
        self.state.ingest(life(t=11, c=6))
        self.assertEqual(self.progress(), (None, None))
        self.state.set_demo(False)
        self.base_frame(tick=11)
        self.state.ingest(life())
        self.assertEqual(self.progress(), (None, None))
        self.state.ingest(life(t=11, c=6))
        self.assertEqual(self.progress(), ("real-game-login", 6))

    def test_missing_life_keeps_legacy_inline_pair_compatibility(self):
        self.base_frame(loginId="legacy-login", combatEnds=7)
        self.assertEqual(self.progress(), ("legacy-login", 7))
        self.now += 6
        self.assertEqual(self.progress(), (None, None))
        self.base_frame(tick=11, combatEnds=9)
        self.assertEqual(self.progress(), ("legacy-login", 9))

    def test_life_capability_does_not_change_combat_or_dead_evidence(self):
        self.base_frame(combat=True, dead=True)
        self.state.ingest(life(c=20))
        current = self.state.view()["snapshot"]
        self.assertEqual(current["combatEnds"], 20)
        self.assertTrue(current["combat"])
        self.assertTrue(current["dead"])

    def test_malformed_life_cannot_mutate_an_accepted_observation(self):
        self.state.ingest(life())
        for changes in ({"c": True}, {"t": -1}, {"l": "invalid login"}):
            with self.subTest(changes=changes), self.assertRaises(FrameError):
                self.state.ingest(life(**changes))
        self.assertEqual(self.progress(), ("real-game-login", 5))


if __name__ == "__main__":
    unittest.main()
