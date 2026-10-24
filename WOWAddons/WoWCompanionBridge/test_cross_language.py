"""Optional integration test: actual Lua addon -> pixels -> Python -> level event."""

import importlib.util
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
