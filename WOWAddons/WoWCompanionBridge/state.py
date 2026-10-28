"""Validated snapshots become bounded, deduplicated companion events."""

from __future__ import annotations

import base64
import copy
import hashlib
import threading
import time
import uuid
from collections import OrderedDict, deque
from datetime import datetime, timezone

from protocol import (COMPARISON_MAX_BYTES, EQUIPMENT_MAX_BYTES, LOADOUT_MAX_BYTES, GAME_PROTOCOLS, FrameError, load_json,
                      validate_equipment_fragment, validate_equipment_record, validate_equipment_swap,
                      validate_equipment_offer, validate_comparison_fragment, validate_equipment_comparison,
                      validate_loadout_fragment, validate_equipment_loadout, validate_macro)

DEFAULT_CONFIG = {"x": 8, "y": 8, "cellSize": 1, "pollMs": 100, "paused": False}
EQUIPMENT_TTL_SECONDS = 180
EQUIPMENT_PENDING_LIMIT = 8
EQUIPMENT_DEDUP_LIMIT = 256
LOADOUT_TTL_SECONDS = 1200
LOADOUT_PENDING_LIMIT = 2
LOADOUT_PENDING_BYTES = LOADOUT_MAX_BYTES * LOADOUT_PENDING_LIMIT


def known_zone(snapshot: dict) -> tuple[int, str] | None:
    """Only positive map IDs with meaningful labels can announce a location change."""
    zone = snapshot["zone"].strip()
    if snapshot["map"] <= 0 or not zone or zone.casefold() in ("当前位置暂不可用", "location unavailable"):
        return None
    return snapshot["map"], zone


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def validate_config(config: dict, current: dict | None = None) -> dict:
    if not isinstance(config, dict) or any(key not in DEFAULT_CONFIG for key in config):
        raise ValueError("仅允许 x、y、cellSize、pollMs、paused 配置")
    result = dict(current or DEFAULT_CONFIG)
    for key, value in config.items():
        if key == "paused":
            if type(value) is not bool:
                raise ValueError("paused 必须是布尔值")
        else:
            low, high = {"x": (-32768, 32767), "y": (-32768, 32767), "cellSize": (1, 12), "pollMs": (100, 5000)}[key]
            if type(value) is not int or not low <= value <= high:
                raise ValueError(f"{key} 必须在 {low}–{high} 范围内")
        result[key] = value
    return result


class CompanionState:
    def __init__(self, config: dict | None = None, clock=time.monotonic, *, game: str = "retail", wall_clock=time.time):
        if game not in GAME_PROTOCOLS:
            raise ValueError("Unknown WoW game version")
        self.game = game
        self.protocol = GAME_PROTOCOLS[game]
        self.lock = threading.RLock()
        self.clock = clock
        self.wall_clock = wall_clock
        self.instance_id = str(uuid.uuid4())
        self.config = validate_config(config or {}, DEFAULT_CONFIG)
        self.snapshot: dict | None = None
        self.events = deque(maxlen=200)
        self.event_id = 0
        self.fresh_at: float | None = None
        self.last_seen: str | None = None
        self.last_tick = None
        self.error = f"等待插件的 {self.protocol} 遥测网格"
        self.demo = False
        self.reset_baseline = True
        self.last_known_zone: tuple[int, str] | None = None
        self.frame_bmp: bytes | None = None
        self.equipment = deque(maxlen=10)
        self.equipment_error: str | None = None
        self.equipment_pending: dict[int, dict] = {}
        self.equipment_seen: OrderedDict[int, None] = OrderedDict()
        self.equipment_rejected: OrderedDict[int, float] = OrderedDict()
        self.equipment_swaps: list[dict] = []
        self.equipment_swap_error: str | None = None
        self.equipment_swap_seen: OrderedDict[int, dict] = OrderedDict()
        self.equipment_swap_floor = 0
        self.equipment_offer: dict | None = None
        self.equipment_offer_error: str | None = None
        self.equipment_offer_expires = 0.0
        self.macro_import = None
        self.macro_import_at = None
        # Comparison fragments have separate queues and error state. They cannot evict item observations or refresh their heartbeat.
        self.equipment_comparisons: list[dict] = []
        self.equipment_comparison_error: str | None = None
        self.comparison_pending: dict[int, dict] = {}
        self.comparison_seen: OrderedDict[int, None] = OrderedDict()
        self.comparison_rejected: OrderedDict[int, float] = OrderedDict()
        self.comparison_floor = 0
        self.equipment_loadout: dict | None = None
        self.equipment_loadout_error: str | None = None
        self.loadout_pending: dict[int, dict] = {}
        self.loadout_rejected: OrderedDict[int, float] = OrderedDict()
        self.loadout_parts: dict[int, bytes] = {}
        self.loadout_count = 0

    def _clear_equipment(self) -> None:
        self.macro_import = None
        self.macro_import_at = None
        self.equipment.clear()
        self.equipment_pending.clear()
        self.equipment_seen.clear()
        self.equipment_rejected.clear()
        self.equipment_error = None
        self.equipment_swaps.clear()
        self.equipment_swap_seen.clear()
        self.equipment_swap_floor = 0
        self.equipment_swap_error = None
        self.equipment_offer = None
        self.equipment_offer_error = None
        self.equipment_offer_expires = 0.0
        self.equipment_comparisons.clear()
        self.equipment_comparison_error = None
        self.comparison_pending.clear()
        self.comparison_seen.clear()
        self.comparison_rejected.clear()
        self.comparison_floor = 0
        self.equipment_loadout = None
        self.equipment_loadout_error = None
        self.loadout_pending.clear()
        self.loadout_rejected.clear()
        self.loadout_parts.clear()
        self.loadout_count = 0

    def _reject_equipment(self, identifier: int) -> None:
        self.equipment_pending.pop(identifier, None)
        self.equipment_rejected[identifier] = self.clock() + EQUIPMENT_TTL_SECONDS
        while len(self.equipment_rejected) > EQUIPMENT_DEDUP_LIMIT:
            self.equipment_rejected.popitem(last=False)

    def _expire_equipment(self) -> None:
        now = self.clock()
        for identifier, expires in list(self.loadout_rejected.items()):
            if expires <= now:
                del self.loadout_rejected[identifier]
        for identifier, pending in list(self.loadout_pending.items()):
            if now - pending["started"] >= LOADOUT_TTL_SECONDS:
                del self.loadout_pending[identifier]
                self.equipment_loadout_error = "当前装备分片等待超时，已丢弃未完成快照"
        for identifier, expires in list(self.equipment_rejected.items()):
            if expires <= now:
                del self.equipment_rejected[identifier]
        for identifier, pending in list(self.equipment_pending.items()):
            if now - pending["started"] >= EQUIPMENT_TTL_SECONDS:
                del self.equipment_pending[identifier]
                self.equipment_error = "装备分片等待超时，已丢弃未完成记录"
        for identifier, expires in list(self.comparison_rejected.items()):
            if expires <= now:
                del self.comparison_rejected[identifier]
        for identifier, pending in list(self.comparison_pending.items()):
            if now - pending["started"] >= EQUIPMENT_TTL_SECONDS:
                del self.comparison_pending[identifier]
                self.equipment_comparison_error = "装备比较分片等待超时，已丢弃未完成记录"

    def _reject_loadout(self, identifier: int) -> None:
        self.loadout_pending.pop(identifier, None)
        self.loadout_rejected[identifier] = self.clock() + LOADOUT_TTL_SECONDS
        while len(self.loadout_rejected) > EQUIPMENT_DEDUP_LIMIT:
            self.loadout_rejected.popitem(last=False)

    def _ingest_equipment_loadout(self, value: dict) -> None:
        """Publish a complete revision atomically. Acquisition history stays separate."""
        self._expire_equipment()
        if self.demo or self._status() != "live" or self.reset_baseline:
            self.loadout_pending.clear()
            self.equipment_loadout_error = "当前装备分片需要当前角色的实时状态帧"
            return
        try:
            fragment = validate_loadout_fragment(value)
            identifier = fragment["id"]
            if (fragment["s"], fragment["g"]) != (self.snapshot["session"], self.snapshot["guid"]):
                raise FrameError("忽略其他角色或会话的当前装备分片")
            raw = base64.b64decode(fragment["d"], validate=True)
            latest = self.equipment_loadout
            if latest is not None and identifier <= latest["id"]:
                if identifier == latest["id"]:
                    if (fragment["n"] != self.loadout_count
                            or self.loadout_parts.get(fragment["p"]) != hashlib.sha256(raw).digest()):
                        raise FrameError("当前装备已完成修订的分片内容冲突，保留原快照")
                return
            if identifier in self.loadout_rejected:
                return
            pending = self.loadout_pending.get(identifier)
            if pending is None:
                if len(self.loadout_pending) >= LOADOUT_PENDING_LIMIT:
                    oldest = min(self.loadout_pending)
                    if identifier <= oldest:
                        raise FrameError("当前装备在途快照已达 2 条，忽略较旧修订")
                    del self.loadout_pending[oldest]
                pending = {"started": self.clock(), "count": fragment["n"], "parts": {}}
                self.loadout_pending[identifier] = pending
            part = fragment["p"]
            previous = pending["parts"].get(part)
            if pending["count"] != fragment["n"] or (previous is not None and previous != raw):
                self._reject_loadout(identifier)
                raise FrameError("当前装备分片内容冲突，已丢弃整套快照")
            used = sum(sum(len(chunk) for chunk in item["parts"].values()) for item in self.loadout_pending.values())
            if used + (len(raw) if previous is None else 0) > LOADOUT_PENDING_BYTES:
                self._reject_loadout(identifier)
                raise FrameError("当前装备在途快照超过内存上限")
            pending["parts"][part] = raw
            if len(pending["parts"]) != pending["count"]:
                return
            payload = b"".join(pending["parts"][index] for index in range(1, pending["count"] + 1))
            try:
                if len(payload) > LOADOUT_MAX_BYTES:
                    raise FrameError("当前装备快照超过 196608 字节")
                record = validate_equipment_loadout(load_json(payload))
                if (record["session"], record["guid"], record["id"]) != (fragment["s"], fragment["g"], identifier):
                    raise FrameError("当前装备快照与分片标识不一致")
            except FrameError:
                self._reject_loadout(identifier)
                raise
            self.equipment_loadout = copy.deepcopy(record)
            self.loadout_parts = {index: hashlib.sha256(chunk).digest() for index, chunk in pending["parts"].items()}
            self.loadout_count = pending["count"]
            self.loadout_pending = {revision: item for revision, item in self.loadout_pending.items() if revision > identifier}
            self.equipment_loadout_error = None
        except FrameError as exc:
            self.equipment_loadout_error = str(exc)

    def _reject_comparison(self, identifier: int) -> None:
        self.comparison_pending.pop(identifier, None)
        self.comparison_rejected[identifier] = self.clock() + EQUIPMENT_TTL_SECONDS
        while len(self.comparison_rejected) > EQUIPMENT_DEDUP_LIMIT:
            self.comparison_rejected.popitem(last=False)

    def _ingest_equipment_comparison(self, value: dict) -> None:
        """Retain the two observed items, without interpreting their relative value."""
        self._expire_equipment()
        if self.demo or self._status() != "live" or self.reset_baseline:
            self.comparison_pending.clear()
            self.equipment_comparison_error = "装备比较分片需要当前角色的实时状态帧"
            return
        try:
            fragment = validate_comparison_fragment(value)
            identifier = fragment["id"]
            if (fragment["s"], fragment["g"]) != (self.snapshot["session"], self.snapshot["guid"]):
                raise FrameError("忽略其他角色或会话的装备比较分片")
            if (identifier <= self.comparison_floor or identifier in self.comparison_seen
                    or identifier in self.comparison_rejected):
                return
            pending = self.comparison_pending.get(identifier)
            if pending is None:
                if len(self.comparison_pending) >= EQUIPMENT_PENDING_LIMIT:
                    raise FrameError("装备比较在途记录已达 8 条，等待现有记录完成")
                pending = {"started": self.clock(), "count": fragment["n"], "parts": {}}
                self.comparison_pending[identifier] = pending
            part = fragment["p"]
            raw = base64.b64decode(fragment["d"], validate=True)
            previous = pending["parts"].get(part)
            if pending["count"] != fragment["n"] or (previous is not None and previous != raw):
                self._reject_comparison(identifier)
                raise FrameError("装备比较分片内容冲突，已丢弃整条记录")
            pending["parts"][part] = raw
            if len(pending["parts"]) != pending["count"]:
                return
            payload = b"".join(pending["parts"][index] for index in range(1, pending["count"] + 1))
            try:
                if len(payload) > COMPARISON_MAX_BYTES:
                    raise FrameError("装备比较记录超过 4096 字节")
                record = validate_equipment_comparison(load_json(payload))
                if (record["session"], record["guid"], record["id"]) != (fragment["s"], fragment["g"], identifier):
                    raise FrameError("装备比较记录与分片标识不一致")
                if record["class"] != self.snapshot["class"]:
                    raise FrameError("装备比较职业与当前角色不一致")
            except FrameError:
                self._reject_comparison(identifier)
                raise
            del self.comparison_pending[identifier]
            self.comparison_seen[identifier] = None
            self.comparison_seen = OrderedDict(sorted(self.comparison_seen.items()))
            while len(self.comparison_seen) > EQUIPMENT_DEDUP_LIMIT:
                removed, _ = self.comparison_seen.popitem(last=False)
                self.comparison_floor = max(self.comparison_floor, removed)
            self.equipment_comparisons = sorted([*self.equipment_comparisons, copy.deepcopy(record)],
                                                key=lambda item: item["id"])[-10:]
            self.equipment_comparison_error = None
        except FrameError as exc:
            self.equipment_comparison_error = str(exc)

    def _ingest_equipment(self, value: dict) -> None:
        """Only complete records from the current live character enter the list."""
        self._expire_equipment()
        if self.demo or self._status() != "live" or self.reset_baseline:
            self.equipment_pending.clear()
            self.equipment_error = "装备分片需要当前角色的实时状态帧"
            return
        try:
            fragment = validate_equipment_fragment(value)
            identifier = fragment["id"]
            if (fragment["s"], fragment["g"]) != (self.snapshot["session"], self.snapshot["guid"]):
                raise FrameError("忽略其他角色或会话的装备分片")
            if identifier in self.equipment_seen or identifier in self.equipment_rejected:
                return
            pending = self.equipment_pending.get(identifier)
            if pending is None:
                if len(self.equipment_pending) >= EQUIPMENT_PENDING_LIMIT:
                    raise FrameError("装备在途记录已达 8 条，等待现有记录完成")
                pending = {"started": self.clock(), "count": fragment["n"], "parts": {}}
                self.equipment_pending[identifier] = pending
            part = fragment["p"]
            raw = base64.b64decode(fragment["d"], validate=True)
            old = pending["parts"].get(part)
            if pending["count"] != fragment["n"] or (old is not None and old != raw):
                self._reject_equipment(identifier)
                raise FrameError("装备分片内容冲突，已丢弃整条记录")
            pending["parts"][part] = raw
            if len(pending["parts"]) != pending["count"]:
                return
            payload = b"".join(pending["parts"][index] for index in range(1, pending["count"] + 1))
            try:
                if len(payload) > EQUIPMENT_MAX_BYTES:
                    raise FrameError("装备记录超过 8192 字节")
                record = validate_equipment_record(load_json(payload))
                if (record["session"], record["guid"], record["id"]) != (fragment["s"], fragment["g"], identifier):
                    raise FrameError("装备记录与分片标识不一致")
            except FrameError:
                self._reject_equipment(identifier)
                raise
            del self.equipment_pending[identifier]
            self.equipment_seen[identifier] = None
            while len(self.equipment_seen) > EQUIPMENT_DEDUP_LIMIT:
                self.equipment_seen.popitem(last=False)
            self.equipment.append(copy.deepcopy(record))
            self.equipment_error = None
        except FrameError as exc:
            self.equipment_error = str(exc)

    def _ingest_equipment_swap(self, value: dict) -> None:
        """Keep historical outcomes for this live session without advancing it."""
        if self.demo or self._status() != "live" or self.reset_baseline:
            self.equipment_swap_error = "换装结果需要当前角色的实时状态帧"
            return
        try:
            result = validate_equipment_swap(value)
            if (result["s"], result["g"]) != (self.snapshot["session"], self.snapshot["guid"]):
                raise FrameError("忽略其他角色或会话的换装结果")
            identifier = result["id"]
            old = self.equipment_swap_seen.get(identifier)
            if old is not None:
                if old != result:
                    raise FrameError("换装结果编号内容冲突，保留原记录")
                return
            # IDs grow within a game session. Forgotten older IDs cannot enter
            # the recent list again or evict newer results during replay.
            if identifier <= self.equipment_swap_floor:
                return
            self.equipment_swap_seen[identifier] = copy.deepcopy(result)
            self.equipment_swap_seen = OrderedDict(sorted(self.equipment_swap_seen.items()))
            while len(self.equipment_swap_seen) > EQUIPMENT_DEDUP_LIMIT:
                removed, _ = self.equipment_swap_seen.popitem(last=False)
                self.equipment_swap_floor = max(self.equipment_swap_floor, removed)
            self.equipment_swaps = sorted([*self.equipment_swaps, copy.deepcopy(result)],
                                          key=lambda item: item["id"])[-10:]
            self.equipment_swap_error = None
        except FrameError as exc:
            self.equipment_swap_error = str(exc)

    def _ingest_equipment_offer(self, value: dict) -> None:
        if self.demo or self._status() != "live" or self.reset_baseline:
            return
        try:
            offer = validate_equipment_offer(value)
            if (offer["s"], offer["g"]) != (self.snapshot["session"], self.snapshot["guid"]):
                raise FrameError("忽略其他角色或会话的换装提议")
            old = self.equipment_offer
            if old and offer["q"] <= old["q"]:
                if offer["q"] == old["q"] and offer != old:
                    raise FrameError("换装提议序号内容冲突")
                if offer == old:
                    self.equipment_offer_error = None
                return
            # Keep the latest closed/expired value as a tombstone. Older ready frames cannot revive it.
            self.equipment_offer = offer
            self.equipment_offer_expires = self.clock() + min(120, max(0, offer["until"] - self.wall_clock()))
            self.equipment_offer_error = None
        except FrameError as exc:
            self.equipment_offer_error = str(exc)

    def _status(self) -> str:
        if self.config["paused"]:
            return "paused"
        if self.demo:
            return "demo"
        if self.snapshot is None or self.fresh_at is None or not self.snapshot["online"]:
            return "waiting"
        return "stale" if self.clock() - self.fresh_at > 5 else "live"

    def view(self, after: int | None = None) -> dict:
        with self.lock:
            self._expire_equipment()
            age = round(max(0, self.clock() - self.fresh_at), 2) if self.fresh_at is not None else None
            status = self._status()
            current_snapshot = copy.deepcopy(self.snapshot)
            # Keep event observations historical. An expired or paused current
            # view must not present the last recorded position as live.
            if current_snapshot is not None and status not in ("live", "demo"):
                current_snapshot["px"], current_snapshot["py"] = None, None
            return {"instanceId": self.instance_id, "status": status, "source": "demo" if self.demo else "screen", "snapshot": current_snapshot,
                    "lastSeen": self.last_seen, "ageSeconds": age, "eventCursor": self.event_id,
                    "events": copy.deepcopy([e for e in self.events if after is None or e["id"] > after]),
                    "config": dict(self.config), "error": self.error if status != "live" else None,
                    "equipment": copy.deepcopy(list(self.equipment)), "equipmentError": self.equipment_error,
                    "equipmentSwaps": copy.deepcopy(self.equipment_swaps), "equipmentSwapError": self.equipment_swap_error,
                    "equipmentOffer": copy.deepcopy(self.equipment_offer) if status == "live" and not self.demo
                    and self.clock() < self.equipment_offer_expires else None,
                    "equipmentOfferError": self.equipment_offer_error,
                    "macroImport": copy.deepcopy(self.macro_import) if status == "live" and not self.demo
                    and not self.error and self.macro_import_at is not None and self.clock() - self.macro_import_at < 2.5 else None,
                    "equipmentComparisons": copy.deepcopy(self.equipment_comparisons),
                    "equipmentComparisonError": self.equipment_comparison_error,
                    "equipmentLoadout": copy.deepcopy(self.equipment_loadout),
                    "equipmentLoadoutError": self.equipment_loadout_error,
                    "staleAfterSeconds": 5, "protocol": self.protocol, "game": self.game}

    def _event(self, kind: str, title: str, detail: str, snapshot: dict) -> None:
        self.event_id += 1
        self.events.append({"id": self.event_id, "type": kind, "timestamp": utc_now(), "title": title,
                            "detail": detail, "snapshot": copy.deepcopy(snapshot), "demo": self.demo})

    def ingest(self, snapshot: dict) -> None:
        with self.lock:
            if snapshot.get("kind") == "macro":
                value = validate_macro(snapshot)
                if self.demo or self._status() != "live" or self.reset_baseline or self.error:
                    return
                if (value["s"], value["g"]) != (self.snapshot["session"], self.snapshot["guid"]):
                    return
                if self.macro_import and value["q"] <= self.macro_import["q"]:
                    return
                self.macro_import, self.macro_import_at = value, self.clock()
                return
            if snapshot.get("kind") == "gear":
                self._ingest_equipment_loadout(snapshot)
                return
            if snapshot.get("kind") == "cmp":
                self._ingest_equipment_comparison(snapshot)
                return
            if snapshot.get("kind") == "eq":
                self._ingest_equipment(snapshot)
                return
            if snapshot.get("kind") == "swap":
                self._ingest_equipment_swap(snapshot)
                return
            if snapshot.get("kind") == "offer":
                self._ingest_equipment_offer(snapshot)
                return
            old = self.snapshot
            identity_changed = old is None or (old["account"], old["guid"], old["session"]) != (snapshot["account"], snapshot["guid"], snapshot["session"])
            was_stale = self._status() not in ("live", "demo")
            if not identity_changed and old is not None and snapshot["seq"] < old["seq"]:
                self.error = "忽略旧序号遥测帧"
                return
            tick_changed = identity_changed or self.last_tick != snapshot["tick"]
            if tick_changed:
                self.fresh_at = self.clock()
                self.last_seen = utc_now()
                self.last_tick = snapshot["tick"]
            self.error = "遥测画面已停更，等待新的心跳" if not tick_changed and self._status() == "stale" else None
            # A repeated, frozen frame must never revive a stale state or generate events.
            if not tick_changed and self._status() == "stale":
                self.reset_baseline = True
                self.equipment_pending.clear()
                self.comparison_pending.clear()
                self.loadout_pending.clear()
                return
            self.snapshot = copy.deepcopy(snapshot)
            if self.reset_baseline or identity_changed or was_stale:
                self._clear_equipment()
                self.reset_baseline = False
                self.last_known_zone = known_zone(snapshot) if snapshot["online"] else None
                if snapshot["online"]:
                    self._event("connected", "已连接角色", f"{snapshot['name']} · {snapshot['level']} 级 · {snapshot['zone']}", snapshot)
                return
            if old is None or snapshot["seq"] == old["seq"]:
                return
            if not snapshot["online"]:
                self._clear_equipment()
                if old["online"]:
                    self._event("offline", "角色已离开世界", "暂停陪伴事件，等待角色重新进入世界", snapshot)
                self.reset_baseline = True
                self.last_known_zone = None
                return
            if snapshot["level"] > old["level"]:
                self._event("level_up", "角色升级", f"{snapshot['name']} 从 {old['level']} 级升到 {snapshot['level']} 级", snapshot)
            zone = known_zone(snapshot)
            if zone is not None:
                # Temporary loading/secret values are not travel. Preserve the last
                # valid region so returning to it does not announce a second journey.
                if self.last_known_zone is not None and zone != self.last_known_zone:
                    self._event("zone", "进入新区域", f"当前区域：{snapshot['zone']}", snapshot)
                self.last_known_zone = zone
            if snapshot["dead"] != old["dead"]:
                if snapshot["dead"]:
                    self._event("death", "角色倒下", "角色已死亡", snapshot)
                else:
                    self._event("revive", "角色复活", "角色已复活，可以继续旅途", snapshot)
            if snapshot["combat"] != old["combat"]:
                kind = "combat_start" if snapshot["combat"] else "combat_end"
                title = "进入战斗" if snapshot["combat"] else "脱离战斗"
                self._event(kind, title, "战斗中减少打扰" if snapshot["combat"] else "战斗结束，恢复日常陪伴", snapshot)

    def capture_error(self, message: str) -> None:
        with self.lock:
            self.error = message
            if self._status() == "stale":
                self.reset_baseline = True
                self.equipment_pending.clear()
                self.comparison_pending.clear()
                self.loadout_pending.clear()

    def capture_swap_error(self, message: str) -> None:
        with self.lock:
            self.equipment_swap_error = message

    def capture_offer_error(self, message: str) -> None:
        with self.lock:
            self.equipment_offer_error = message

    def capture_comparison_error(self, message: str) -> None:
        with self.lock:
            self.equipment_comparison_error = message

    def capture_loadout_error(self, message: str) -> None:
        with self.lock:
            self.equipment_loadout_error = message

    def update_config(self, patch: dict) -> dict:
        with self.lock:
            result = validate_config(patch, self.config)
            changed = result != self.config
            self.config = result
            if changed:
                self._clear_equipment()
                self.reset_baseline = True
                self.last_known_zone = None
                self.fresh_at = None
                self.last_tick = None
            return dict(result)

    def set_demo(self, enabled: bool, action: str | None = None) -> None:
        if type(enabled) is not bool:
            raise ValueError("enabled 必须是布尔值")
        if action not in (None, "level_up", "zone", "death", "revive", "combat"):
            raise ValueError("未知演示动作")
        if action and not enabled:
            raise ValueError("演示动作要求 enabled=true")
        with self.lock:
            if enabled != self.demo:
                self._clear_equipment()
                self.demo = enabled
                self.snapshot = None
                self.fresh_at = None
                self.last_tick = None
                self.last_seen = None
                self.reset_baseline = True
                self.last_known_zone = None
                self.frame_bmp = None
                self.error = "演示数据，不来自游戏" if enabled else "等待真实游戏遥测"
            if not enabled:
                return
            if self.snapshot is None:
                self.ingest({"v": 3, "session": "demo-session", "seq": 1, "tick": 1, "guid": "DEMO-PLAYER",
                             "name": "演示冒险者", "realm": "无限服演示" if self.game == "forever" else "正式服演示", "level": 29, "class": "MAGE", "spec": 0 if self.game == "forever" else 64,
                             "faction": "Alliance", "race": "人类",
                             "map": 37, "zone": "艾尔文森林（演示）", "px": None, "py": None, "combat": False, "dead": False, "online": True,
                             "account": "demo-account", "moneyEpoch": "demo-epoch", "copper": 1234567, "earned": 0, "spent": 0})
            if action:
                next_state = dict(self.snapshot)
                next_state["seq"] += 1
                next_state["tick"] += 1
                if action == "level_up":
                    next_state["level"] = min(255, next_state["level"] + 1)
                elif action == "zone":
                    next_state["map"] = 84 if next_state["map"] == 37 else 37
                    next_state["zone"] = "暴风城（演示）" if next_state["map"] == 84 else "艾尔文森林（演示）"
                elif action in ("death", "revive"):
                    next_state["dead"] = action == "death"
                elif action == "combat":
                    next_state["combat"] = not next_state["combat"]
                self.ingest(next_state)
