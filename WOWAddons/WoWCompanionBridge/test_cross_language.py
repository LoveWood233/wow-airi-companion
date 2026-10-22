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
        spec = importlib.util.spec_from_file_location("wow_addon_harness", ADDON / "tests" / "test_addon.py")
        harness = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(harness)
        lua = LuaRuntime(encoding=None, unpack_returned_tuples=True)
        lua.execute(harness.MOCK)
        ns = lua.table()
        loader = lua.eval(b"function(source, ns) local f, err=loadstring(source); assert(f,err); return f('WoWMapCompanion', ns) end")
        for filename in ("Protocol.lua", "Telemetry.lua", "WoWMapCompanion.lua"):
            loader((ADDON / filename).read_bytes(), ns)
        g = lua.globals()
        g.Fire(b"ADDON_LOADED", b"WoWMapCompanion")
        g.Fire(b"PLAYER_ENTERING_WORLD")
        engine = CompanionState()

        def render_and_ingest():
            frame, _, _ = ns[b"Protocol"][b"Encode"](g.WoWMapCompanionDB[b"snapshot"])
            decoded = decode_frame(frame)
            pixels = pixels_for_frame(frame, cell_size=2)
            from_pixels = decode_pixels(pixels, 128, 128, 2)
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


if __name__ == "__main__":
    unittest.main()
