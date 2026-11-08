"""Bounded container assembly and cursor-based delivery. Item details never inflate the frequent status response."""
from __future__ import annotations

import base64
import copy
import hashlib
import json

from protocol import FrameError, _integer, _text, load_json, validate_loadout_item

MAX_BYTES = 2097152
MAX_PARTS = (MAX_BYTES + 239) // 240


def validate_storage_item(value, version):
    """Container items can be materials without an equipment slot. Classification is observed, never inferred from labels."""
    if not isinstance(value, dict):
        raise FrameError("Invalid stored item")
    base = dict(value)
    if version == 2:
        for key in ("classID", "subclassID"):
            if key not in base:
                raise FrameError("Missing stored item classification")
            classification = base.pop(key)
            if classification is not None:
                _integer(classification, key, 0, 255)
    validate_loadout_item(base, allow_unequippable=True)
    if len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()) > 8192:
        raise FrameError("Stored item exceeds limit")
    return value


def validate_storage(value):
    fields = {"v", "id", "session", "guid", "observedAt", "scope", "container", "capacity", "complete", "cached", "slots"}
    if not isinstance(value, dict) or set(value) != fields:
        raise FrameError("Invalid item storage fields")
    version = _integer(value["v"], "v", 1, 2)
    _integer(value["id"], "id", 1, 2147483647)
    _text(value["session"], "session", 40, identity=True)
    _text(value["guid"], "guid", 48, identity=True)
    _integer(value["observedAt"], "observedAt", 1, 4102444800)
    _integer(value["container"], "container", -10, 1000)
    capacity = _integer(value["capacity"], "capacity", 0, 200)
    if value["scope"] not in ("bags", "bank", "account-bank") or type(value["complete"]) is not bool or type(value["cached"]) is not bool:
        raise FrameError("Invalid item storage scope or flags")
    if not isinstance(value["slots"], list) or len(value["slots"]) != capacity:
        raise FrameError("Incomplete item storage slot list")
    for index, slot in enumerate(value["slots"], 1):
        if not isinstance(slot, dict) or set(slot) != {"slot", "state", "quantity", "item"} or slot["slot"] != index:
            raise FrameError("Invalid item storage slot")
        _integer(slot["slot"], "slot", 1, 200)
        if slot["state"] not in ("occupied", "empty", "unknown"):
            raise FrameError("Invalid item storage state")
        occupied = slot["state"] == "occupied"
        _integer(slot["quantity"], "quantity", 1 if occupied else 0, 1000000 if occupied else 0)
        if occupied:
            validate_storage_item(slot["item"], version)
        elif slot["item"] is not None or (value["complete"] and slot["state"] == "unknown"):
            raise FrameError("Unknown slots cannot establish complete storage")
    if len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()) > MAX_BYTES:
        raise FrameError("Item storage exceeds limit")
    return value


class ItemStorageAssembler:
    """Session resets discard partial and current containers. The publication cursor stays monotonic within the bridge instance."""

    def __init__(self, clock, wall_clock):
        self.clock, self.wall_clock = clock, wall_clock
        self.sequence = 0
        self.reset()

    def reset(self):
        self.pending = {}
        self.records = {}
        self.completed = {}
        self.error = None

    def ingest(self, fragment, snapshot):
        try:
            if (fragment["s"], fragment["g"]) != (snapshot["session"], snapshot["guid"]):
                return
            now = self.clock()
            self.pending = {key: value for key, value in self.pending.items() if now - value["started"] <= 36000}
            identifier = fragment["id"]
            chunk = base64.b64decode(fragment["d"], validate=True)
            digest = hashlib.sha256(chunk).digest()
            completed = self.completed.get(identifier)
            if completed:
                if completed.get(fragment["p"]) != digest:
                    raise FrameError("Conflicting completed item storage fragment")
                return
            if identifier not in self.pending:
                if len(self.pending) >= 2:
                    del self.pending[min(self.pending, key=lambda key: self.pending[key]["started"])]
                self.pending[identifier] = {"started": now, "count": fragment["n"], "parts": {}}
            pending = self.pending[identifier]
            if pending["count"] != fragment["n"] or (fragment["p"] in pending["parts"] and pending["parts"][fragment["p"]] != chunk):
                del self.pending[identifier]
                raise FrameError("Conflicting item storage fragments")
            pending["parts"][fragment["p"]] = chunk
            if len(pending["parts"]) != pending["count"]:
                return
            del self.pending[identifier]
            body = b"".join(pending["parts"][index] for index in range(1, pending["count"] + 1))
            if len(body) > MAX_BYTES:
                raise FrameError("Item storage exceeds limit")
            record = validate_storage(load_json(body))
            if (record["session"], record["guid"], record["id"]) != (fragment["s"], fragment["g"], identifier):
                raise FrameError("Item storage identity mismatch")
            if record["observedAt"] > self.wall_clock() + 120:
                raise FrameError("Item storage capture is in the future")
            key = (record["scope"], record["container"])
            prior = self.records.get(key)
            if prior and (prior["record"]["id"] >= identifier or prior["record"]["observedAt"] > record["observedAt"]):
                return
            if key not in self.records and len(self.records) >= 40:
                raise FrameError("Too many item storage containers")
            if prior:
                self.completed.pop(prior["record"]["id"], None)
            self.sequence += 1
            self.records[key] = {"cursor": self.sequence, "record": record}
            self.completed[identifier] = {part: hashlib.sha256(value).digest() for part, value in pending["parts"].items()}
            self.error = None
        except (FrameError, ValueError) as exc:
            self.error = str(exc)

    def read(self, after):
        # One bounded container per page avoids repeatedly shipping the whole bank over local HTTP.
        matches = sorted((entry for entry in self.records.values() if entry["cursor"] > after), key=lambda entry: entry["cursor"])
        entry = matches[0] if matches else None
        return {"cursor": entry["cursor"] if entry else max(after, self.sequence),
                "record": copy.deepcopy(entry["record"]) if entry else None, "hasMore": len(matches) > 1}
