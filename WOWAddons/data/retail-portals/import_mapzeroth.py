"""Read pinned Modern travel literals without loading or executing Lua."""

from __future__ import annotations

import argparse
from collections import Counter
from copy import deepcopy
from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess


REVISION = "905f1d89adcf0551dedcd4277cce2cc1cde914be"
SOURCE_ID = "mapzeroth-modern-2.0.5"
SOURCE_URL = "https://github.com/tr0tsky0/Mapzeroth"
LICENSE_URL = "https://www.curseforge.com/wow/addons/mapzeroth/license"
ROOT = Path(__file__).resolve().parents[2]


class LiteralError(ValueError):
    """The source is outside the supported literal subset."""


@dataclass(frozen=True)
class Token:
    kind: str
    value: object
    start: int
    end: int


class LiteralTable(dict):
    """A record table, with its source position retained for attribution."""

    def __init__(self, values: dict, start: int, end: int):
        super().__init__(values)
        self.start = start
        self.end = end


class LiteralArray(list):
    """A sequence table, with its source position retained for attribution."""

    def __init__(self, values: list, start: int, end: int):
        super().__init__(values)
        self.start = start
        self.end = end


def long_bracket(text: str, start: int) -> tuple[int, int] | None:
    match = re.match(r"\[(=*)\[", text[start:])
    if not match:
        return None
    content = start + match.end()
    close = text.find("]" + match.group(1) + "]", content)
    if close < 0:
        raise LiteralError(f"Unclosed long string or comment at offset {start}")
    return content, close + len(match.group(1)) + 2


def read_string(text: str, start: int) -> tuple[str, int]:
    quote = text[start]
    output = []
    cursor = start + 1
    escapes = {"a": "\a", "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t", "v": "\v"}
    while cursor < len(text):
        char = text[cursor]
        cursor += 1
        if char == quote:
            return "".join(output), cursor
        if char in "\r\n":
            raise LiteralError(f"Unescaped newline in string at offset {start}")
        if char != "\\":
            output.append(char)
            continue
        if cursor >= len(text):
            break
        char = text[cursor]
        cursor += 1
        if char in escapes:
            output.append(escapes[char])
        elif char in "\\\"'":
            output.append(char)
        elif char == "z":
            while cursor < len(text) and text[cursor].isspace():
                cursor += 1
        elif char.isdigit() and char.isascii():
            match = re.match(r"[0-9]{0,2}", text[cursor:])
            digits = char + match.group(0)
            cursor += len(match.group(0))
            number = int(digits)
            if number > 255:
                raise LiteralError("Lua decimal escape exceeds one byte")
            output.append(chr(number))
        elif char == "x":
            digits = text[cursor:cursor + 2]
            if not re.fullmatch(r"[0-9a-fA-F]{2}", digits):
                raise LiteralError("Invalid Lua hexadecimal escape")
            output.append(chr(int(digits, 16)))
            cursor += 2
        elif char in "\r\n":
            if char == "\r" and text[cursor:cursor + 1] == "\n":
                cursor += 1
            output.append("\n")
        else:
            raise LiteralError(f"Unsupported string escape: {char!r}")
    raise LiteralError(f"Unclosed string at offset {start}")


def skip_space(text: str, cursor: int) -> int:
    while cursor < len(text):
        if text[cursor].isspace():
            cursor += 1
        elif text.startswith("--", cursor):
            bracket = long_bracket(text, cursor + 2)
            if bracket:
                cursor = bracket[1]
            else:
                newline = text.find("\n", cursor)
                cursor = len(text) if newline < 0 else newline + 1
        else:
            break
    return cursor


def code_mask(text: str) -> str:
    """Hide comments and strings without shifting any source offsets."""
    output = list(text)
    cursor = 0
    while cursor < len(text):
        start = cursor
        if text.startswith("--", cursor):
            bracket = long_bracket(text, cursor + 2)
            if bracket:
                cursor = bracket[1]
            else:
                newline = text.find("\n", cursor)
                cursor = len(text) if newline < 0 else newline
        elif text[cursor] in "\"'":
            _, cursor = read_string(text, cursor)
        elif text[cursor] == "[" and (bracket := long_bracket(text, cursor)):
            cursor = bracket[1]
        else:
            cursor += 1
            continue
        for index in range(start, cursor):
            if text[index] not in "\r\n":
                output[index] = " "
    return "".join(output)


class LiteralParser:
    """Parse table, string, number, boolean and nil literals only."""

    def __init__(self, text: str, cursor: int = 0):
        self.text = text
        self.cursor = cursor
        self.cached: Token | None = None

    def peek(self) -> Token:
        if self.cached is not None:
            return self.cached
        start = skip_space(self.text, self.cursor)
        if start >= len(self.text):
            token = Token("eof", None, start, start)
        elif self.text[start] in "\"'":
            value, end = read_string(self.text, start)
            token = Token("string", value, start, end)
        elif self.text[start] == "[" and (bracket := long_bracket(self.text, start)):
            content, end = bracket
            close_length = len(re.match(r"\[(=*)\[", self.text[start:]).group(1)) + 2
            value = self.text[content:end - close_length]
            value = re.sub(r"^(?:\r\n|\r|\n)", "", value)
            token = Token("string", value, start, end)
        elif match := re.match(r"-?(?:0[xX][0-9A-Fa-f]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)", self.text[start:]):
            raw = match.group(0)
            value = int(raw, 16) if "x" in raw.lower() else float(raw) if any(char in raw for char in ".eE") else int(raw)
            if isinstance(value, float) and not math.isfinite(value):
                raise LiteralError("Non-finite number")
            token = Token("number", value, start, start + len(raw))
        elif match := re.match(r"[A-Za-z_][A-Za-z_0-9]*", self.text[start:]):
            token = Token("name", match.group(0), start, start + match.end())
        else:
            token = Token(self.text[start], self.text[start], start, start + 1)
        self.cached = token
        return token

    def take(self, kind: str | None = None) -> Token:
        token = self.peek()
        if kind is not None and token.kind != kind:
            self.fail(f"Expected {kind!r}, got {token.kind!r}", token)
        self.cursor = token.end
        self.cached = None
        return token

    def fail(self, message: str, token: Token | None = None) -> None:
        token = token or self.peek()
        line = self.text.count("\n", 0, token.start) + 1
        raise LiteralError(f"{message} at line {line}")

    def value(self, depth: int = 0):
        if depth > 32:
            self.fail("Table nesting exceeds 32")
        token = self.peek()
        if token.kind in ("string", "number"):
            return self.take().value
        if token.kind == "name" and token.value in ("true", "false", "nil"):
            self.take()
            return {"true": True, "false": False, "nil": None}[token.value]
        if token.kind != "{":
            self.fail("Only literal values are accepted", token)
        start = self.take("{").start
        record = {}
        sequence = []
        while self.peek().kind != "}":
            if self.peek().kind == "name" and self.peek().value not in ("true", "false", "nil"):
                key = self.take("name").value
                self.take("=")
                if key in record:
                    self.fail(f"Duplicate table key {key!r}")
                record[key] = self.value(depth + 1)
            elif self.peek().kind == "[":
                self.take("[")
                key = self.take("string").value
                self.take("]")
                self.take("=")
                if key in record:
                    self.fail(f"Duplicate table key {key!r}")
                record[key] = self.value(depth + 1)
            else:
                sequence.append(self.value(depth + 1))
            if record and sequence:
                self.fail("Mixed record and sequence tables are unsupported")
            if self.peek().kind == "}":
                break
            if self.peek().kind not in (",", ";"):
                self.fail("Expected a field separator")
            self.take()
        end = self.take("}").end
        return LiteralArray(sequence, start, end) if sequence else LiteralTable(record, start, end)


def parse_literal(text: str):
    """Public test boundary: reject expressions after a complete literal."""
    parser = LiteralParser(text)
    result = parser.value()
    if parser.peek().kind != "eof":
        parser.fail("Unexpected expression after literal")
    return result


def parse_assignment(text: str, target: str):
    mask = code_mask(text)
    pattern = rf"(?m)^\s*{target}\s*=\s*(?=\{{)"
    matches = list(re.finditer(pattern, mask))
    if len(matches) != 1:
        raise LiteralError(f"Expected one assignment matching {target!r}, found {len(matches)}")
    parser = LiteralParser(text, matches[0].end())
    result = parser.value()
    if parser.peek().kind != "eof":
        parser.fail("Unexpected code after the data assignment")
    if not isinstance(result, LiteralArray):
        raise LiteralError("The data assignment must contain a non-empty sequence")
    return result


def source_record(value: LiteralTable, text: str, relative: str, digest: str) -> dict:
    if not isinstance(value, LiteralTable):
        raise LiteralError(f"Expected a record table in {relative}")
    line = text.count("\n", 0, value.start) + 1
    end_of_line = text.find("\n", value.end)
    suffix = text[value.end:len(text) if end_of_line < 0 else end_of_line]
    comment = re.fullmatch(r"\s*[,;]?\s*--(.*)", suffix)
    result = dict(value)
    result.update(source_file=relative, source_line=line, source_sha256=digest)
    if comment:
        result["label_en"] = comment.group(1).strip()
        result["label_origin"] = "source_comment"
    return result


def validate_node(node: dict) -> None:
    if not isinstance(node.get("id"), str) or not node["id"]:
        raise LiteralError("Node ID must be non-empty text")
    if type(node.get("mapID")) is not int or node["mapID"] <= 0:
        raise LiteralError(f"Invalid map ID for {node['id']}")
    for field in ("x", "y"):
        value = node.get(field)
        if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1:
            raise LiteralError(f"Invalid normalized {field} for {node['id']}: {value!r}")
    if not isinstance(node.get("container"), str) or not node["container"]:
        raise LiteralError(f"Node container missing for {node['id']}")


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def expand_portals(edges: list[dict], nodes: dict[str, dict]) -> tuple[list[dict], dict]:
    """Mirror TravelGraph's authored reverse suppression, without player filtering."""
    authored = {(edge.get("from"), edge.get("to"), edge.get("method")) for edge in edges}
    selected = [edge for edge in edges if edge.get("method") == "portal"]
    routes = []
    seen_edges = set()
    suppressed = 0
    for edge in selected:
        for field in ("from", "to"):
            if edge.get(field) not in nodes:
                raise LiteralError(f"Dangling portal endpoint {edge.get(field)!r} at {edge.get('source_file')}:{edge.get('source_line')}")
        if "oneway" in edge and type(edge["oneway"]) is not bool:
            raise LiteralError("Portal oneway must be a boolean")
        requirements = edge.get("requirements", {})
        if not isinstance(requirements, dict):
            raise LiteralError("Portal requirements must be a record")
        raw = {key: value for key, value in edge.items() if key not in {"source_file", "source_line", "source_sha256", "label_en", "label_origin"}}
        fingerprint = canonical(raw)
        if fingerprint in seen_edges:
            raise LiteralError(f"Duplicate authored portal edge: {edge['from']} -> {edge['to']}")
        seen_edges.add(fingerprint)
        directions = [(edge["from"], edge["to"], False)]
        reverse_authored = (edge["to"], edge["from"], "portal") in authored
        if not edge.get("oneway"):
            if reverse_authored:
                suppressed += 1
            else:
                directions.append((edge["to"], edge["from"], True))
        for from_node, to_node, reverse in directions:
            key = canonical({"from": from_node, "to": to_node, "reverse": reverse, "raw_edge": raw})
            route = {
                "id": "mzr-" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:24],
                "from_node": from_node,
                "to_node": to_node,
                "requirements": deepcopy(requirements),
                "in_phase": deepcopy(edge.get("inPhase")),
                "overrides_phase": deepcopy(edge.get("overridesPhase")),
                "reverse_from_bidirectional": reverse,
                "source_file": edge["source_file"],
                "source_line": edge["source_line"],
                "source_sha256": edge["source_sha256"],
                "raw_edge": deepcopy(raw),
            }
            if "label_en" in edge:
                route["source_comment"] = edge["label_en"]
            routes.append(route)
    ids = [route["id"] for route in routes]
    if len(ids) != len(set(ids)):
        raise LiteralError("Duplicate generated route IDs")
    return sorted(routes, key=lambda route: route["id"]), {
        "parsed_edges_total": len(edges),
        "authored_portal_edges": len(selected),
        "excluded_non_portal_edges": len(edges) - len(selected),
        "authored_oneway_portal_edges": sum(edge.get("oneway") is True for edge in selected),
        "generated_reverse_routes": sum(route["reverse_from_bidirectional"] for route in routes),
        "suppressed_reverse_authored": suppressed,
        "directed_portal_routes": len(routes),
        "excluded_methods": dict(sorted(Counter(edge.get("method") for edge in edges if edge.get("method") != "portal").items())),
    }


def extract(repository: Path) -> dict:
    revision = subprocess.check_output(["git", "-C", str(repository), "rev-parse", "HEAD"], text=True).strip()
    if revision != REVISION:
        raise LiteralError(f"Source revision must equal {REVISION}, got {revision}")
    modern = repository / "Data" / "Modern"
    files = sorted(modern.glob("Nodes*.lua")) + [modern / "Settlements.lua", modern / "Edges.lua"]
    if len(files) < 3 or any(not file.is_file() for file in files):
        raise LiteralError("Modern node, settlement or edge source files are missing")
    nodes = {}
    edges = []
    manifest = []
    for path in files:
        relative = path.relative_to(repository).as_posix()
        raw_bytes = path.read_bytes()
        expected = subprocess.check_output(["git", "-C", str(repository), "show", f"{REVISION}:{relative}"])
        if raw_bytes != expected:
            # Git can normalize LF to CRLF on Windows. Text must still match the pinned object.
            if raw_bytes.replace(b"\r\n", b"\n") != expected.replace(b"\r\n", b"\n"):
                raise LiteralError(f"Source differs from the pinned commit: {relative}")
        text = raw_bytes.decode("utf-8-sig")
        digest = hashlib.sha256(raw_bytes).hexdigest()
        manifest.append({"path": relative, "sha256": digest, "bytes": len(raw_bytes)})
        target = r"addon\.Edges" if path.name == "Edges.lua" else r"addon\.Nodes\.[A-Za-z_][A-Za-z_0-9]*"
        values = parse_assignment(text, target)
        for value in values:
            record = source_record(value, text, relative, digest)
            if path.name == "Edges.lua":
                edges.append(record)
                continue
            validate_node(record)
            if record["id"] in nodes:
                raise LiteralError(f"Duplicate node ID: {record['id']}")
            nodes[record["id"]] = record
    routes, statistics = expand_portals(edges, nodes)
    referenced = {route[field] for route in routes for field in ("from_node", "to_node")}
    statistics.update(parsed_nodes_total=len(nodes), portal_nodes=len(referenced),
                      excluded_non_portal_nodes=len(nodes) - len(referenced), rejected_records=0)
    license_files = [path.relative_to(repository).as_posix() for path in repository.iterdir()
                     if path.is_file() and re.search(r"license|copying", path.name, re.I)]
    return {
        "schema_version": 1,
        "game_branch": "retail",
        "coordinate_scale": "normalized_0_1",
        "source": {
            "id": SOURCE_ID,
            "title": "Mapzeroth 2.0.5 Modern travel data",
            "url": SOURCE_URL,
            "tag": "2.0.5",
            "tag_url": SOURCE_URL + "/tree/2.0.5",
            "revision": revision,
            "release_date": "2026-10-25",
            "reviewed_at": "2026-10-29",
            "license": "MIT",
            "license_url": LICENSE_URL,
            "license_in_repository": license_files,
            "toc_note": "The tagged repository retains Mapzeroth Dev / 2.0.0-dev metadata. Data selection uses the pinned 2.0.5 release tag and Data/Modern only.",
            "files": manifest,
            "direction_rule": "TravelGraph.lua:445-465. Expand a missing reverse for a portal without oneway. An explicitly authored reverse suppresses expansion.",
            "label_note": "label_en is a source comment, not an independently verified destination name.",
        },
        "statistics": statistics,
        "nodes": [nodes[node_id] for node_id in sorted(referenced)],
        "routes": routes,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "research" / "portal-sources" / "Mapzeroth")
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("mapzeroth.json"))
    arguments = parser.parse_args()
    try:
        catalog = extract(arguments.source.resolve())
    except (LiteralError, OSError, subprocess.CalledProcessError) as exc:
        parser.exit(1, f"Import rejected: {exc}\n")
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(catalog, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(arguments.output), **catalog["statistics"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
