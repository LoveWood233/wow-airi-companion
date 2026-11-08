"""Check catalog integrity and safe local queries."""

from contextlib import closing
import math
from pathlib import Path
import sqlite3
import tempfile
import unittest

import catalog


class CatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = catalog.load_catalog()
        cls.temporary = tempfile.TemporaryDirectory()
        cls.database = Path(cls.temporary.name) / "test.sqlite3"
        catalog.build_database(cls.data, cls.database)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_real_data_is_retail_and_references_exist(self):
        self.assertGreater(len(self.data["routes"]), 200)
        self.assertTrue(all(row["game_branch"] == "retail" for row in self.data["routes"]))
        with closing(sqlite3.connect(self.database)) as database:
            self.assertEqual(database.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(database.execute("PRAGMA foreign_key_check").fetchall(), [])
            self.assertEqual(database.execute("SELECT count(*) FROM portal_routes").fetchone()[0], len(self.data["routes"]))

    def test_coordinate_conversion_does_not_invent_landings(self):
        self.assertEqual(catalog.coordinate_pair(0.1234, 0.5678, 1), (12.34, 56.78))
        self.assertTrue(all(row["arrival_x"] is None and row["arrival_y"] is None for row in self.data["routes"]))
        for row in self.data["routes"]:
            self.assertTrue(0 <= row["source_x"] <= 100 and 0 <= row["source_y"] <= 100)

    def test_invalid_coordinates_are_rejected(self):
        for pair in [(None, 4), (True, 3), (math.nan, 2), (101, 0), (math.inf, 0)]:
            with self.subTest(pair=pair), self.assertRaises(ValueError):
                catalog.coordinate_pair(*pair)

    def test_queries_work_with_chinese_and_faction(self):
        rows = catalog.query_database(self.database, from_text="暴风城", faction="Alliance", limit=1000)
        self.assertGreater(len(rows), 5)
        self.assertTrue(all(row["source_map_id"] == 84 for row in rows))
        self.assertTrue(all(row["faction"] in ("Alliance", "Unknown", "Neutral") for row in rows))

    def test_query_input_cannot_change_sql(self):
        self.assertEqual(catalog.query_database(self.database, from_text="' OR 1=1 --"), [])
        self.assertEqual(catalog.query_database(self.database, from_text="%"), [])
        self.assertTrue(catalog.query_database(self.database, map_id=85))

    def test_nearest_is_same_map_only(self):
        rows = catalog.query_database(self.database, map_id=84, x=50, y=90)
        self.assertTrue(rows)
        self.assertTrue(all(row["source_map_id"] == 84 for row in rows))
        values = [row["map_coordinate_difference"] for row in rows]
        self.assertEqual(values, sorted(values))
        with self.assertRaises(ValueError):
            catalog.query_database(self.database, x=50, y=90)

    def test_unknown_source_and_duplicate_record_fail(self):
        row = dict(self.data["routes"][0])
        with self.assertRaises(ValueError):
            catalog.validate([row, row], [], {item["id"]: item for item in self.data["sources"]})
        row["source_ids"] = ["missing-source"]
        with self.assertRaises(ValueError):
            catalog.validate([row], [], {})

    def test_rebuild_keeps_old_database_backup(self):
        catalog.build_database(self.data, self.database)
        backups = list(self.database.parent.glob("test.sqlite3.*.bak"))
        self.assertTrue(backups)
        with closing(sqlite3.connect(backups[-1])) as database:
            self.assertEqual(database.execute("PRAGMA integrity_check").fetchone()[0], "ok")

    def test_known_source_conflicts_are_kept_but_hidden_from_default_query(self):
        all_rows = catalog.query_database(self.database, include_uncertain=True, limit=10000)
        safe_rows = catalog.query_database(self.database, limit=10000)
        flagged = [row for row in all_rows if row["availability"] == "uncertain"]
        self.assertTrue(flagged)
        self.assertTrue(all(row["availability"] != "uncertain" for row in safe_rows))
        self.assertEqual(len(all_rows) - len(safe_rows), len(flagged))

    def test_source_map_is_not_taken_from_a_destination_in_the_description(self):
        maps = {row["map_id"]: row for row in self.data["maps"]}
        self.assertEqual(catalog.resolve_map("The Maw - Waystone to Oribos", maps, from_source=True), 1543)
        self.assertEqual(catalog.resolve_map("Dalaran (Broken Isles - Legion phase)", maps, from_source=True), 627)
        self.assertEqual(catalog.resolve_map("Foundation Hall, Dornogal", maps), 2339)
        observation = next(row for row in self.data["observations"] if row["id"] == "observation-regions-maw-to-oribos")
        self.assertEqual(observation["source_map_id"], 1543)
        self.assertEqual(observation["destination_map_id"], 1670)

    def test_each_candidate_has_its_own_coordinate_comparison(self):
        checked = 0
        for route in self.data["routes"]:
            for observation in route["independent_observations"]:
                if observation["source_x"] is None:
                    continue
                checked += 1
                difference = math.hypot(route["source_x"] - observation["source_x"], route["source_y"] - observation["source_y"])
                self.assertEqual(observation["comparison"], "nearby" if difference <= 1.5 else "different")
        self.assertGreater(checked, 20)


if __name__ == "__main__":
    unittest.main()
