"""Regenerate the addon ranges from the documented OpenMap values."""
import re
from pathlib import Path


LEVEL_ROW = re.compile(
    r"^\| ([^|]+?) \| (\d+)–(\d+) \| "
    r"\[(\d+)\]\(https://wuxianwow\.com/atlas/\4\) \|$"
)


def main():
    addon = Path(__file__).resolve().parents[1]
    source = addon.parent / "docs/wow-forever-map-level-ranges.md"
    lines = [
        "-- Source: OpenMap v0.8.5 map label ranges in docs/wow-forever-map-level-ranges.md.",
        "-- These bounds are the same as the world map hover labels.",
        "-- Refresh with tools/update_exploration_levels.py. Missing levels stay absent.",
        "local _, ns = ...", "ns.ExplorationLevels = {",
    ]
    seen = set()
    for line in source.read_text(encoding="utf-8").splitlines():
        match = LEVEL_ROW.fullmatch(line)
        if not match:
            continue
        title, low, high, identifier = match.groups()
        map_id, minimum, maximum = int(identifier), int(low), int(high)
        if map_id <= 0 or map_id in seen or not 1 <= minimum <= maximum <= 60:
            raise ValueError(f"Invalid OpenMap level range for map {map_id}")
        seen.add(map_id)
        lines.append(f"    [{map_id}] = {{ min = {minimum}, max = {maximum} }}, -- {title}")
    if not seen:
        raise ValueError("The reference contains no numeric OpenMap level ranges")
    lines.append("}")
    destination = addon / "ExplorationLevels.lua"
    destination.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Updated {len(seen)} maps: {destination}")


if __name__ == "__main__":
    main()
