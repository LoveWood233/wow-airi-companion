"""Build and query the local Retail portal catalog with Python standard libraries."""

from __future__ import annotations

import argparse
from contextlib import closing
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import tempfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent
DATABASE = ROOT / "retail-portals.sqlite3"
SCHEMA_VERSION = 1


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def json_text(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def coordinate_pair(x, y, scale=100):
    if x is None and y is None:
        return None, None
    for value in (x, y):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError("Coordinates must be a finite pair or a null pair")
        if not 0 <= value <= scale:
            raise ValueError("Coordinates exceed their map range")
    return round(x * 100 / scale, 6), round(y * 100 / scale, 6)


def map_label(maps, map_id, language):
    item = maps.get(map_id, {})
    return item.get(f"name_{language}") or f"UIMap #{map_id}"


def resolve_map(name, maps, from_source=False):
    if not name:
        return None
    def normalized(text):
        return re.sub(r"[^a-z0-9]+", " ", re.sub(r"\bthe\s+", "", text.casefold())).strip()

    folded = normalized(name)
    candidates = []
    for map_id, item in maps.items():
        for label in [item.get("name_en"), *item.get("aliases_en", [])]:
            if label:
                key = normalized(label)
                matches = (folded == key or folded.startswith(key + " ")) if from_source else key in folded
                if matches:
                    candidates.append((len(key), map_id))
    if not candidates:
        return None
    candidates.sort(reverse=True)
    longest = candidates[0][0]
    best = {map_id for length, map_id in candidates if length == longest}
    return next(iter(best)) if len(best) == 1 else None


def requirements_text(requirements, phase):
    labels = {"faction": "阵营", "class": "职业", "race": "种族", "minLevel": "最低等级",
              "maxLevel": "最高等级", "quest": "已完成任务", "notQuest": "尚未完成任务",
              "holiday": "节日活动", "minReputation": "最低声望", "anyQuest": "至少完成其中一个任务",
              "anyOf": "至少满足其中一个条件"}
    parts = [f"{labels.get(key, key)}：{json_text(value)}" for key, value in requirements.items()]
    if phase:
        parts.append("相位条件：" + json_text(phase))
    return "；".join(parts) or "来源未列出额外条件，仍需在游戏内核对剧情与相位。"


def load_catalog(root=ROOT):
    root = Path(root)
    imported = read_json(root / "mapzeroth.json")
    map_data = read_json(root / "maps.json")
    maps = {row["map_id"]: row for row in map_data["maps"]}
    if len(maps) != len(map_data["maps"]):
        raise ValueError("Duplicate map IDs")
    source = imported["source"]
    source_id = source["id"]
    sources = {source_id: source}
    for item in map_data.get("sources", []):
        sources[item["id"]] = item
    quality = map_data.get("quality_issues", [])
    nodes = {row["id"]: row for row in imported["nodes"]}
    if len(nodes) != len(imported["nodes"]):
        raise ValueError("Duplicate node IDs")
    routes = []
    observations = []
    for edge in imported["routes"]:
        start, end = nodes[edge["from_node"]], nodes[edge["to_node"]]
        x, y = coordinate_pair(start.get("x"), start.get("y"), 1)
        dest_x, dest_y = coordinate_pair(end.get("x"), end.get("y"), 1)
        reqs = edge.get("requirements") or {}
        phase = edge.get("in_phase")
        conditional = bool(reqs or phase or edge.get("raw_edge", {}).get("overridesPhase"))
        source_file = edge["source_file"]
        routes.append({
            "id": edge["id"], "game_branch": "retail", "basis": "mapzeroth",
            "from_node": start["id"], "to_node": end["id"],
            "source_map_id": start["mapID"], "source_map_name_zh": map_label(maps, start["mapID"], "zh"),
            "source_map_name_en": map_label(maps, start["mapID"], "en"),
            "source_x": x, "source_y": y, "source_floor": None,
            "source_container": start.get("container"),
            "source_point_name": start.get("label_en") or start["id"],
            "destination_map_id": end["mapID"], "destination_name_zh": map_label(maps, end["mapID"], "zh"),
            "destination_name_en": map_label(maps, end["mapID"], "en"),
            "destination_point_name": end.get("label_en") or end["id"],
            "destination_anchor_x": dest_x, "destination_anchor_y": dest_y,
            "arrival_x": None, "arrival_y": None,
            "faction": reqs.get("faction", "Unknown"), "category": "special" if reqs.get("class") else "world",
            "requirements": reqs, "in_phase": phase, "requirements_zh": requirements_text(reqs, phase),
            "availability": "conditional" if conditional else "documented",
            "validation_status": "source_only", "coordinate_role": "source_graph_point",
            "reverse_from_bidirectional": edge.get("reverse_from_bidirectional", False),
            "source_ids": [source_id], "source_section": f"{source_file}:{edge['source_line']}",
            "source_url": f"https://github.com/tr0tsky0/Mapzeroth/blob/{source['revision']}/{source_file}#L{edge['source_line']}",
            "notes_zh": "图中起点坐标可能是门或区域参考点。目的节点坐标仅为导航锚点，不作为实测传送落点。"
        })
        issues = [item for item in quality if item.get("node_id") in (start["id"], end["id"])]
        routes[-1]["quality_issues"] = issues
        if issues:
            routes[-1]["availability"] = "uncertain"
            routes[-1]["validation_status"] = "source_conflict"
            routes[-1]["notes_zh"] += " " + " ".join(item["notes_zh"] for item in issues)
    for file in (root / "hubs.json", root / "regions.json"):
        supplement = read_json(file)
        for item in supplement.get("sources", []):
            old = sources.get(item["id"])
            if old and old != item:
                raise ValueError(f"Conflicting source ID: {item['id']}")
            sources[item["id"]] = item
        for item in supplement["routes"]:
            item = dict(item)
            item["id"] = "observation-" + file.stem + "-" + item["id"]
            item["source_map_id"] = item.get("source_map_id") or resolve_map(item.get("source_map_name_en"), maps, from_source=True)
            item["destination_map_id"] = item.get("destination_map_id") or resolve_map(item.get("destination_name_en"), maps)
            item["source_x"], item["source_y"] = coordinate_pair(item.get("source_x"), item.get("source_y"))
            item["arrival_x"], item["arrival_y"] = coordinate_pair(item.get("arrival_x"), item.get("arrival_y"))
            item["matched_route_ids"] = []
            if item["source_map_id"] and item["destination_map_id"]:
                matches = [route for route in routes if route["source_map_id"] == item["source_map_id"]
                           and route["destination_map_id"] == item["destination_map_id"]
                           and route["faction"] in (item["faction"], "Unknown", "Neutral")]
                item["matched_route_ids"] = [row["id"] for row in matches]
                if item["source_x"] is not None and matches:
                    item["closest_coordinate_difference"] = round(min(math.hypot(
                        row["source_x"] - item["source_x"], row["source_y"] - item["source_y"])
                        for row in matches), 4)
                    item["comparison"] = "nearby" if item["closest_coordinate_difference"] <= 1.5 else "different"
                else:
                    item["comparison"] = "direction_only" if matches else "not_matched"
            else:
                item["comparison"] = "map_unresolved"
            observations.append(item)
    by_route = {}
    route_lookup = {route["id"]: route for route in routes}
    for observation in observations:
        for route_id in observation["matched_route_ids"]:
            comparison = "direction_only"
            difference = None
            if observation["source_x"] is not None:
                route = route_lookup[route_id]
                difference = round(math.hypot(route["source_x"] - observation["source_x"],
                                              route["source_y"] - observation["source_y"]), 4)
                comparison = "nearby" if difference <= 1.5 else "different"
            by_route.setdefault(route_id, []).append({
                "observation_id": observation["id"], "comparison": comparison,
                "coordinate_difference": difference,
                "source_ids": observation["source_ids"], "source_x": observation["source_x"],
                "source_y": observation["source_y"], "source_floor": observation.get("source_floor")})
    for route in routes:
        route["independent_observations"] = by_route.get(route["id"], [])
        if any(item["comparison"] == "different" for item in route["independent_observations"]):
            route["notes_zh"] += " 独立资料记录不同坐标，详情保留原值，请在游戏内核对。"
    validate(routes, observations, sources)
    return {"metadata": {"schema_version": SCHEMA_VERSION, "game_branch": "retail",
            "reviewed_at": "2026-10-29", "coordinate_system": "UI map percent 0..100",
            "live_validation": False, "snapshot_conversion": "px / 100, py / 100",
            "coverage": "Published Mapzeroth 2.0.5 Modern portal edges, plus separate sourced observations. Not an exhaustive live-world census.",
            "import_statistics": imported.get("statistics", {})},
            "sources": list(sources.values()), "maps": list(maps.values()),
            "nodes": list(nodes.values()), "routes": routes, "observations": observations}


def validate(routes, observations, sources):
    seen = set()
    for row in routes + observations:
        if row["id"] in seen:
            raise ValueError("Duplicate route/observation IDs")
        seen.add(row["id"])
        coordinate_pair(row.get("source_x"), row.get("source_y"))
        coordinate_pair(row.get("arrival_x"), row.get("arrival_y"))
        for field in ("source_map_id", "destination_map_id"):
            value = row.get(field)
            if value is not None and (isinstance(value, bool) or not isinstance(value, int) or value <= 0):
                raise ValueError("Map ID must be a positive integer or null")
        if not row.get("source_ids") or any(key not in sources for key in row["source_ids"]):
            raise ValueError("Every record needs a known source")


SCHEMA = """
PRAGMA foreign_keys=ON;
CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE sources(id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL, license TEXT NOT NULL, reviewed_at TEXT NOT NULL, revision TEXT, data_json TEXT NOT NULL);
CREATE TABLE maps(map_id INTEGER PRIMARY KEY CHECK(map_id>0), name_zh TEXT, name_en TEXT, data_json TEXT NOT NULL);
CREATE TABLE nodes(id TEXT PRIMARY KEY, map_id INTEGER NOT NULL, x REAL NOT NULL CHECK(x BETWEEN 0 AND 1), y REAL NOT NULL CHECK(y BETWEEN 0 AND 1), container TEXT, data_json TEXT NOT NULL);
CREATE TABLE portal_routes(id TEXT PRIMARY KEY, game_branch TEXT NOT NULL CHECK(game_branch='retail'), from_node TEXT NOT NULL REFERENCES nodes(id), to_node TEXT NOT NULL REFERENCES nodes(id), source_map_id INTEGER NOT NULL, source_map_name_zh TEXT NOT NULL, source_map_name_en TEXT NOT NULL, source_x REAL NOT NULL CHECK(source_x BETWEEN 0 AND 100), source_y REAL NOT NULL CHECK(source_y BETWEEN 0 AND 100), source_floor TEXT, source_point_name TEXT NOT NULL, destination_map_id INTEGER NOT NULL, destination_name_zh TEXT NOT NULL, destination_name_en TEXT NOT NULL, destination_point_name TEXT NOT NULL, faction TEXT NOT NULL, requirements_json TEXT NOT NULL, requirements_zh TEXT NOT NULL, availability TEXT NOT NULL, validation_status TEXT NOT NULL, source_url TEXT NOT NULL, data_json TEXT NOT NULL);
CREATE TABLE route_sources(route_id TEXT NOT NULL REFERENCES portal_routes(id), source_id TEXT NOT NULL REFERENCES sources(id), PRIMARY KEY(route_id,source_id));
CREATE TABLE portal_observations(id TEXT PRIMARY KEY, source_map_id INTEGER, source_x REAL, source_y REAL, destination_map_id INTEGER, comparison TEXT NOT NULL, data_json TEXT NOT NULL, CHECK((source_x IS NULL AND source_y IS NULL) OR (source_x IS NOT NULL AND source_y IS NOT NULL AND source_x BETWEEN 0 AND 100 AND source_y BETWEEN 0 AND 100)));
CREATE TABLE observation_sources(observation_id TEXT NOT NULL REFERENCES portal_observations(id), source_id TEXT NOT NULL REFERENCES sources(id), PRIMARY KEY(observation_id,source_id));
CREATE TABLE coordinate_checks(observation_id TEXT NOT NULL REFERENCES portal_observations(id), route_id TEXT NOT NULL REFERENCES portal_routes(id), PRIMARY KEY(observation_id,route_id));
CREATE INDEX routes_from_map ON portal_routes(source_map_id, faction);
CREATE INDEX routes_to_map ON portal_routes(destination_map_id, faction);
"""


def build_database(catalog, destination=DATABASE):
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix=".portals-", suffix=".sqlite3", dir=destination.parent)
    os.close(handle)
    database = None
    try:
        with sqlite3.connect(temporary) as database:
            database.executescript(SCHEMA)
            database.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
            for key, value in catalog["metadata"].items():
                database.execute("INSERT INTO metadata VALUES(?,?)", (key, json_text(value)))
            for item in catalog["sources"]:
                database.execute("INSERT INTO sources VALUES(?,?,?,?,?,?,?)", (
                    item["id"], item["title"], item["url"], item["license"], item["reviewed_at"], item.get("revision"), json_text(item)))
            for item in catalog["maps"]:
                database.execute("INSERT INTO maps VALUES(?,?,?,?)", (item["map_id"], item.get("name_zh"), item.get("name_en"), json_text(item)))
            for item in catalog["nodes"]:
                database.execute("INSERT INTO nodes VALUES(?,?,?,?,?,?)", (item["id"], item["mapID"], item["x"], item["y"], item.get("container"), json_text(item)))
            columns = "id game_branch from_node to_node source_map_id source_map_name_zh source_map_name_en source_x source_y source_floor source_point_name destination_map_id destination_name_zh destination_name_en destination_point_name faction requirements_json requirements_zh availability validation_status source_url data_json".split()
            for item in catalog["routes"]:
                values = dict(item, requirements_json=json_text(item["requirements"]), data_json=json_text(item))
                database.execute("INSERT INTO portal_routes VALUES(" + ",".join("?" for _ in columns) + ")", [values[key] for key in columns])
                database.executemany("INSERT INTO route_sources VALUES(?,?)", [(item["id"], key) for key in item["source_ids"]])
            for item in catalog["observations"]:
                database.execute("INSERT INTO portal_observations VALUES(?,?,?,?,?,?,?)", (item["id"], item.get("source_map_id"), item.get("source_x"), item.get("source_y"), item.get("destination_map_id"), item["comparison"], json_text(item)))
                database.executemany("INSERT INTO observation_sources VALUES(?,?)", [(item["id"], key) for key in item["source_ids"]])
                database.executemany("INSERT INTO coordinate_checks VALUES(?,?)", [(item["id"], key) for key in item["matched_route_ids"]])
            if database.execute("PRAGMA integrity_check").fetchone()[0] != "ok" or database.execute("PRAGMA foreign_key_check").fetchall():
                raise ValueError("SQLite integrity check failed")
        database.close()
        if destination.exists():
            stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
            backup = destination.with_name(destination.name + "." + stamp + ".bak")
            with closing(sqlite3.connect(destination)) as old, closing(sqlite3.connect(backup)) as saved:
                old.backup(saved)
        os.replace(temporary, destination)
    finally:
        if database is not None:
            database.close()
        if os.path.exists(temporary):
            os.unlink(temporary)


def literal_like(value):
    return "%" + value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def query_database(path=DATABASE, from_text=None, to_text=None, map_id=None, faction=None, limit=50, x=None, y=None, include_uncertain=False):
    if not 1 <= limit <= 10000:
        raise ValueError("Limit must be between 1 and 10000")
    if (x is None) != (y is None) or (x is not None and map_id is None):
        raise ValueError("Nearest search needs a map ID and both coordinates")
    if x is not None:
        coordinate_pair(x, y)
    where, values = ([] if include_uncertain else ["availability != 'uncertain'"]), []
    if map_id is not None:
        where.append("source_map_id=?")
        values.append(map_id)
    for text, fields in ((from_text, ("source_map_name_zh", "source_map_name_en", "source_point_name")),
                         (to_text, ("destination_name_zh", "destination_name_en", "destination_point_name"))):
        if text:
            where.append("(" + " OR ".join(field + " LIKE ? ESCAPE '\\'" for field in fields) + ")")
            values.extend([literal_like(text)] * len(fields))
    if faction:
        if faction not in ("Alliance", "Horde", "Neutral", "Unknown"):
            raise ValueError("Invalid faction")
        where.append("faction=?" if faction in ("Unknown", "Neutral") else "faction IN (?, 'Unknown', 'Neutral')")
        values.append(faction)
    sql = "SELECT data_json FROM portal_routes" + (" WHERE " + " AND ".join(where) if where else "")
    sql += " ORDER BY source_map_id, destination_map_id, id"
    with closing(sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True)) as database:
        rows = [json.loads(row[0]) for row in database.execute(sql, values)]
    if x is not None:
        for row in rows:
            row["map_coordinate_difference"] = round(math.hypot(row["source_x"] - x, row["source_y"] - y), 4)
        rows.sort(key=lambda row: row["map_coordinate_difference"])
    return rows[:limit]


def export_catalog(catalog, root=ROOT):
    root = Path(root)
    (root / "portals.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
    fields = ["id", "source_map_id", "source_map_name_zh", "source_map_name_en", "source_x", "source_y", "source_floor", "source_point_name", "destination_map_id", "destination_name_zh", "destination_name_en", "destination_point_name", "faction", "requirements_zh", "availability", "validation_status", "source_url"]
    with (root / "portals.csv").open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(catalog["routes"])
    template = (root / "viewer-template.html").read_text(encoding="utf-8")
    payload = json_text(catalog).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    (root / "index.html").write_text(template.replace("__PORTAL_DATA__", payload), encoding="utf-8")
    files = ["retail-portals.sqlite3", "portals.json", "portals.csv", "mapzeroth.json", "hubs.json", "regions.json", "maps.json"]
    manifest = {"schema_version": SCHEMA_VERSION, "reviewed_at": "2026-10-29", "counts": {"routes": len(catalog["routes"]), "observations": len(catalog["observations"]), "nodes": len(catalog["nodes"]), "maps": len(catalog["maps"])},
                "sha256": {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in files}}
    (root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="魔兽世界正式服传送门本地数据库")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("build", help="从本地来源 JSON 重建数据库及离线网页")
    query = sub.add_parser("query", help="只读查询，不连接网络")
    query.add_argument("--from", dest="from_text")
    query.add_argument("--to", dest="to_text")
    query.add_argument("--map-id", type=int)
    query.add_argument("--faction", choices=["Alliance", "Horde", "Neutral", "Unknown"])
    query.add_argument("--x", type=float)
    query.add_argument("--y", type=float)
    query.add_argument("--limit", type=int, default=50)
    query.add_argument("--include-uncertain", action="store_true", help="包括存在来源疑点的路线")
    args = parser.parse_args()
    if args.command == "build":
        catalog = load_catalog()
        build_database(catalog)
        export_catalog(catalog)
        print(json_text({"database": str(DATABASE), "routes": len(catalog["routes"]), "observations": len(catalog["observations"]), "integrity": "ok"}))
    else:
        options = vars(args).copy()
        options.pop("command")
        print(json.dumps(query_database(**options), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
