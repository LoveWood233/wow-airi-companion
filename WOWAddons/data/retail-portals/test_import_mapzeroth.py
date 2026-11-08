"""Exercise the literal boundary and directed portal import rules."""

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest

from import_mapzeroth import (
    LiteralArray,
    LiteralError,
    LiteralTable,
    REVISION,
    ROOT,
    SOURCE_ID,
    canonical,
    expand_portals,
    extract,
    parse_assignment,
    parse_literal,
    source_record,
    validate_node,
)


class LiteralParserTests(unittest.TestCase):
    def test_nested_records_sequences_scalars_and_comments(self):
        result = parse_literal('''-- top
        { name = "Portal", coords = { 0.5, 1, -2e-3 },
          requirements = { faction = 'Alliance', unlocked = true, blocked = false, value = nil },
          -- skip this field = os.execute('bad')
          ["note"] = [=[A multiline
comment-looking -- string]=], empty = {} }
        ''')
        self.assertEqual(result["coords"], [0.5, 1, -0.002])
        self.assertEqual(result["requirements"], {"faction": "Alliance", "unlocked": True, "blocked": False, "value": None})
        self.assertEqual(result["note"], "A multiline\ncomment-looking -- string")
        self.assertEqual(result["empty"], {})
        self.assertIsInstance(result, LiteralTable)
        self.assertIsInstance(result["coords"], LiteralArray)

    def test_string_escapes_do_not_execute_text(self):
        result = parse_literal(r'''{value = "A\nB\t\"C\"\065\x42", code = "os.execute('anything')"}''')
        self.assertEqual(result["value"], 'A\nB\t"C"AB')
        self.assertEqual(result["code"], "os.execute('anything')")

    def test_hex_numbers_and_whitespace_escapes(self):
        self.assertEqual(parse_literal('{0x10, -0xFF, .5, 1E3}'), [16, -255, .5, 1000])
        self.assertEqual(parse_literal('"a\\z  \n  b"'), "ab")

    def test_comment_and_string_assignment_decoys_are_ignored(self):
        source = '''-- addon.Edges = { { method = "wrong" } }
        --[=[
addon.Edges = { { method = "wrong" } }
        ]=]
        local ignored = "addon.Edges = {}"
        addon.Edges = { { method = "portal" } } -- trailing comment
        '''
        result = parse_assignment(source, r"addon\.Edges")
        self.assertEqual(result[0]["method"], "portal")

    def test_rejects_functions_calls_arithmetic_and_interpolation(self):
        attempts = (
            '{ x = function() return 1 end }',
            '{ x = os.execute("echo unsafe") }',
            '{ x = require("os") }',
            '{ x = 0.5 + 0.1 }',
            '{ x = "a" .. "b" }',
            '{ x = _G["anything"] }',
            '{ x = addon.position }',
            '{}; os.execute("unsafe")',
            '{ x = 1e9999 }',
        )
        for text in attempts:
            with self.subTest(text=text), self.assertRaises(LiteralError):
                parse_literal(text)

    def test_rejects_duplicate_fields_mixed_tables_and_invalid_escapes(self):
        for text in ('{x=1,x=2}', '{["x"]=1,x=2}', '{1,x=2}', '"\\999"', '"\\q"', '"\\xA"'):
            with self.subTest(text=text), self.assertRaises(LiteralError):
                parse_literal(text)

    def test_rejects_incomplete_data_and_extreme_nesting(self):
        for text in ('{ x = "bad', '{ x = 1', '{ x = --[[ unclosed', '{' * 35 + '1' + '}' * 35):
            with self.subTest(text=text), self.assertRaises(LiteralError):
                parse_literal(text)

    def test_assignment_requires_one_literal_sequence(self):
        for text in ('addon.Edges = {}', 'addon.Edges = function() end', 'addon.Edges = {{}}\naddon.Edges = {{}}', 'addon.Edges = {{}}\nreturn unsafe()'):
            with self.subTest(text=text), self.assertRaises(LiteralError):
                parse_assignment(text, r"addon\.Edges")

    def test_source_line_and_comment_are_separate_from_data(self):
        source = 'prefix\naddon.Edges = {\n { id = "A" }, -- Source comment only\n}\n'
        value = parse_assignment(source, r"addon\.Edges")[0]
        digest = hashlib.sha256(source.encode()).hexdigest()
        record = source_record(value, source, "Data/Modern/Nodes_EK.lua", digest)
        self.assertEqual(record["source_line"], 3)
        self.assertEqual(record["source_sha256"], digest)
        self.assertEqual(record["label_en"], "Source comment only")
        self.assertEqual(record["label_origin"], "source_comment")
        self.assertNotIn("label_en", value)


class RouteTests(unittest.TestCase):
    def setUp(self):
        self.nodes = {key: {"id": key} for key in ("A", "B", "C")}

    def edge(self, start="A", end="B", **extra):
        return {"from": start, "to": end, "method": "portal", "cost": 0,
                "source_file": "Data/Modern/Edges.lua", "source_line": 12,
                "source_sha256": "ab" * 32, **extra}

    def test_oneway_is_only_authored_direction(self):
        routes, stats = expand_portals([self.edge(oneway=True)], self.nodes)
        self.assertEqual([(route["from_node"], route["to_node"]) for route in routes], [("A", "B")])
        self.assertFalse(routes[0]["reverse_from_bidirectional"])
        self.assertEqual(stats["generated_reverse_routes"], 0)

    def test_bidirectional_copies_requirements_and_phase_without_inference(self):
        edge = self.edge(requirements={"quest": 123, "faction": "Alliance"}, inPhase=["group", 12], overridesPhase=True)
        routes, stats = expand_portals([edge], self.nodes)
        self.assertEqual({(route["from_node"], route["to_node"]) for route in routes}, {("A", "B"), ("B", "A")})
        self.assertEqual(stats["generated_reverse_routes"], 1)
        for route in routes:
            self.assertEqual(route["requirements"], edge["requirements"])
            self.assertEqual(route["in_phase"], ["group", 12])
            self.assertIs(route["overrides_phase"], True)
            self.assertEqual(route["raw_edge"]["inPhase"], ["group", 12])
            self.assertNotIn("source_line", route["raw_edge"])
        reverse = next(route for route in routes if route["reverse_from_bidirectional"])
        reverse["requirements"]["quest"] = 456
        self.assertEqual(edge["requirements"]["quest"], 123)

    def test_explicit_reverse_suppresses_synthetic_even_with_different_requirements(self):
        edges = [self.edge(), self.edge("B", "A", oneway=True, requirements={"quest": 456})]
        routes, stats = expand_portals(edges, self.nodes)
        self.assertEqual(len(routes), 2)
        self.assertTrue(all(not route["reverse_from_bidirectional"] for route in routes))
        self.assertEqual(stats["suppressed_reverse_authored"], 1)
        self.assertEqual(next(route for route in routes if route["from_node"] == "B")["requirements"], {"quest": 456})

    def test_nonportal_methods_are_excluded_but_counted(self):
        routes, stats = expand_portals([self.edge(oneway=True), self.edge("A", "C", method="ship")], self.nodes)
        self.assertEqual(len(routes), 1)
        self.assertEqual(stats["excluded_methods"], {"ship": 1})
        self.assertEqual(stats["excluded_non_portal_edges"], 1)

    def test_duplicate_edges_dangling_ids_and_invalid_constraints_fail(self):
        cases = ([self.edge(), self.edge()], [self.edge("A", "MISSING")],
                 [self.edge(oneway="yes")], [self.edge(requirements=["Alliance"])])
        for edges in cases:
            with self.subTest(edges=edges), self.assertRaises(LiteralError):
                expand_portals(edges, self.nodes)

    def test_route_ids_are_stable_across_order_and_source_line_changes(self):
        edge = self.edge(requirements={"quest": 12, "faction": "Horde"})
        changed = deepcopy(edge)
        changed["source_line"] = 99
        changed["source_sha256"] = "cd" * 32
        changed["requirements"] = {"faction": "Horde", "quest": 12}
        original, _ = expand_portals([edge], self.nodes)
        updated, _ = expand_portals([changed], self.nodes)
        self.assertEqual([route["id"] for route in original], [route["id"] for route in updated])

    def test_node_coordinates_require_finite_nonboolean_normalized_values(self):
        node = {"id": "A", "container": "world.map84.interior", "mapID": 84, "x": 0, "y": 1}
        validate_node(node)
        for fields in ({"mapID": True}, {"mapID": 0}, {"x": True}, {"x": float("nan")}, {"y": 1.01}, {"y": -0.01}, {"container": ""}):
            with self.subTest(fields=fields), self.assertRaises(LiteralError):
                validate_node({**node, **fields})


class PinnedCatalogTests(unittest.TestCase):
    def test_pinned_real_sources_and_reproducible_export(self):
        repository = ROOT / "research" / "portal-sources" / "Mapzeroth"
        if not (repository / ".git").exists():
            self.skipTest("Pinned source checkout is not available")
        catalog = extract(repository)
        exported = json.loads(Path(__file__).with_name("mapzeroth.json").read_text(encoding="utf-8"))
        self.assertEqual(canonical(catalog), canonical(exported))
        self.assertEqual(catalog["source"]["revision"], REVISION)
        self.assertEqual(catalog["source"]["id"], SOURCE_ID)
        self.assertEqual(catalog["statistics"]["authored_portal_edges"], 203)
        self.assertEqual(catalog["statistics"]["directed_portal_routes"], 263)
        self.assertEqual(catalog["statistics"]["portal_nodes"], 242)
        self.assertEqual(catalog["statistics"]["rejected_records"], 0)
        self.assertTrue(all(route["raw_edge"]["method"] == "portal" for route in catalog["routes"]))
        self.assertTrue(all(item["path"].startswith("Data/Modern/") for item in catalog["source"]["files"]))
        ids = {node["id"] for node in catalog["nodes"]}
        self.assertTrue(all(route["from_node"] in ids and route["to_node"] in ids for route in catalog["routes"]))
        source = next(node for node in catalog["nodes"] if node["id"] == "PORTAL_STORMWIND_DORNOGAL")
        self.assertEqual((source["mapID"], source["x"], source["y"]), (84, 0.4797, 0.9211))
        target = next(route for route in catalog["routes"] if route["from_node"] == source["id"])
        self.assertEqual(target["to_node"], "DORNOGAL_PORTAL_ROOM")
        self.assertEqual(target["requirements"], {"minLevel": 68, "faction": "Alliance"})


if __name__ == "__main__":
    unittest.main()
