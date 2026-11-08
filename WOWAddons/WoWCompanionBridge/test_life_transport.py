"""Synthetic game events and real Lua pixels preserve life telemetry within the existing grid."""
import importlib.util
import json
import unittest

from protocol import FrameError, decode_pixels, encode_frame, validate_life
from state import CompanionState
from test_cross_language import ADDON, LuaRuntime


def addon_runtime(addon):
    spec = importlib.util.spec_from_file_location("life_transport_harness", addon / "tests" / "test_addon.py")
    harness = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(harness)
    lua = LuaRuntime(encoding=None, unpack_returned_tuples=True)
    lua.execute(harness.MOCK)
    ns = lua.table()
    loader = lua.eval(b"function(source,name,ns) assert(loadstring(source))(name,ns) end")
    for line in (addon / (addon.name + ".toc")).read_text("utf-8-sig").splitlines():
        if line.strip().endswith(".lua") and not line.lstrip().startswith("#"):
            loader((addon / line.strip()).read_bytes(), addon.name.encode(), ns)
    lua.globals().Fire(b"ADDON_LOADED", addon.name.encode())
    lua.globals().Fire(b"PLAYER_ENTERING_WORLD", True, False)
    return lua, ns


def rendered_message(lua, ns, frame, magic):
    ns[b"Telemetry"][b"Render"](frame)
    name = b"WoWCompanionTelemetry" if magic == "WCP1" else b"WoWForeverCompanionTelemetry"
    textures = lua.globals().Objects[name][b"textures"]
    pixels = bytearray()
    for index in range(1, 4097):
        color = textures[index][b"color"]
        pixels.extend((round(color[3] * 255), round(color[2] * 255), round(color[1] * 255), 255))
    return decode_pixels(bytes(pixels), 64, 64, 1, magic)


class LifeValidationTests(unittest.TestCase):
    def test_exact_fields_versions_identities_and_integer_counters(self):
        valid = dict(v=1, kind="life", s="session", g="Player-1-A", l="login", c=5, t=9)
        self.assertEqual(validate_life(valid), valid)
        for changes in ({"v": True}, {"v": 2}, {"kind": "other"}, {"s": ""}, {"s": "x" * 41},
                        {"g": "x" * 49}, {"l": "x" * 41}, {"l": "bad id"}, {"l": "登录"},
                        {"c": True}, {"c": -1}, {"c": 1.5}, {"c": 2147483648}, {"t": False},
                        {"t": -1}, {"t": 2147483648}, {"extra": 0}):
            with self.subTest(changes=changes), self.assertRaises(FrameError):
                validate_life({**valid, **changes})
        for key in valid:
            with self.subTest(missing=key), self.assertRaises(FrameError):
                validate_life({field: value for field, value in valid.items() if field != key})
        for magic in ("WCP1", "WCF1"):
            self.assertEqual(len(encode_frame(valid, magic)), 512)


@unittest.skipUnless(LuaRuntime, "Real addon pixel tests require the existing test-only Lua runtime")
class LifePixelTransportTests(unittest.TestCase):
    def test_all_eighteen_realistic_chinese_snapshots_preserve_existing_fields_and_life(self):
        for addon, game, magic in ((ADDON, "retail", "WCP1"), (ADDON.parent / "WoWForeverCompanion", "forever", "WCF1")):
            lua, ns = addon_runtime(addon)
            baseline = dict(lua.globals()[(addon.name + "DB").encode()][b"snapshot"].items())
            _, first_life = ns[b"Transfer"][b"LifeFrame"]()
            login = json.loads(first_life)["l"]
            cases = 0
            for name in ("星河冒险", "银月远行旅人"):
                for realm, zone in (("银月", "银月"), ("死亡之翼", "艾尔文森林"), ("深渊之巢王国", "赞达拉港口区")):
                    for economy in ("early", "normal", "rich"):
                        with self.subTest(game=game, name=name, realm=realm, economy=economy):
                            values = dict(v=3, name=name, realm=realm, zone=zone, guid="Player-1234-01234567",
                                          loginId=login, combatEnds=5, seq=1234, tick=34567, level=90, faction="Horde",
                                          race="血精灵", spec=70, map=2393, instanceType="none", instanceID=None,
                                          px=4523, py=6012, combat=False, dead=False, online=True,
                                          copper=123456789, earned=98765432, spent=12345678)
                            if economy == "early":
                                values.update(copper=100000, earned=12345, spent=1234, seq=20, tick=120)
                            elif economy == "rich":
                                values.update(copper=12345678901, earned=23456789012, spent=1234567890,
                                              seq=123456, tick=1234567, race="赞达拉巨魔", instanceType="party", instanceID=2652)
                            source = dict(baseline)
                            source.update({key.encode(): value.encode() if isinstance(value, str) else value for key, value in values.items()})
                            table = lua.table_from(source)
                            frame, payload, _ = ns[b"Protocol"][b"Encode"](table)
                            baseline_source = {key: value for key, value in source.items() if key not in (b"loginId", b"combatEnds")}
                            _, baseline_payload, _ = ns[b"Protocol"][b"Encode"](lua.table_from(baseline_source))
                            self.assertEqual(payload, baseline_payload)
                            life, life_payload = ns[b"Protocol"][b"EncodeLife"](table)
                            self.assertEqual(len(frame), 512)
                            self.assertEqual(len(life), 512)
                            self.assertLessEqual(len(payload), 504)
                            self.assertLessEqual(len(life_payload), 220)
                            decoded = rendered_message(lua, ns, frame, magic)
                            self.assertNotIn("loginId", decoded)
                            for key in ("name", "realm", "race", "instanceType", "instanceID"):
                                self.assertEqual(decoded[key], values[key])
                            for key in ("account", "moneyEpoch", "copper", "earned", "spent"):
                                self.assertEqual(decoded[key], source[key.encode()].decode() if isinstance(source[key.encode()], bytes) else source[key.encode()])
                            state = CompanionState(game=game)
                            state.ingest(decoded)
                            before = state.view()
                            state.ingest(rendered_message(lua, ns, life, magic))
                            current = state.view()
                            self.assertEqual(current["snapshot"]["loginId"], login)
                            self.assertEqual(current["snapshot"]["combatEnds"], 5)
                            self.assertEqual(current["lastSeen"], before["lastSeen"])
                            self.assertEqual(current["eventCursor"], before["eventCursor"])
                            cases += 1
            self.assertEqual(cases, 18)

    def test_life_every_two_seconds_keeps_snapshot_phases_and_comparison_slots(self):
        for addon in (ADDON, ADDON.parent / "WoWForeverCompanion"):
            with self.subTest(addon=addon.name):
                lua, ns = addon_runtime(addon)
                source = lua.globals()[(addon.name + "DB").encode()][b"snapshot"]
                base, _, _ = ns[b"Protocol"][b"Encode"](source)
                lua.execute(b"Clock=0; function GetTime() return Clock end")
                candidate = dict(itemID=123, itemLevel=100, name="New armor", equipLoc="INVTYPE_CHEST",
                                 type="Armor", subtype="Cloth", stats=[], complete=True, complex=False)
                kinds, life_slots = [], []
                for slot in range(1, 49):
                    lua.globals().Clock = slot / 4
                    if slot % 2 == 1:
                        record = dict(v=2, id=slot, session=source[b"session"].decode(), guid=source[b"guid"].decode(),
                                      **{"class": "MAGE"}, spec=64, primary=4, observedAt=1700000000, slot=0,
                                      usable=True, candidate=candidate)
                        encoded = {key.encode(): value.encode() if isinstance(value, str) else value for key, value in record.items()}
                        encoded[b"candidate"] = lua.table_from({key.encode(): value.encode() if isinstance(value, str) else lua.table() if key == "stats" else value for key, value in candidate.items()})
                        encoded[b"assessment"] = lua.table_from({b"verdict": b"review", b"reason": b"no_target"})
                        encoded[b"deltas"] = lua.table()
                        self.assertTrue(ns[b"Transfer"][b"AddComparison"](lua.table_from(encoded)))
                    ns[b"Transfer"][b"Advance"]()
                    frame = ns[b"Transfer"][b"Current"](base)
                    length = frame[4] + frame[5] * 256
                    value = json.loads(frame[8:8 + length])
                    kinds.append(value.get("kind", "snapshot"))
                    if value.get("kind") == "life":
                        life_slots.append(slot)
                    if slot % 2 == 0:
                        self.assertNotIn("kind", value)
                self.assertGreaterEqual(len(life_slots), 6)
                self.assertTrue(all(second - first <= 8 for first, second in zip(life_slots, life_slots[1:])))
                self.assertEqual(kinds.count("snapshot"), 24)
                # The existing calendar lane can also occupy three slots in this twelve-second sample.
                self.assertGreaterEqual(kinds.count("cmp"), 15)


if __name__ == "__main__":
    unittest.main()
