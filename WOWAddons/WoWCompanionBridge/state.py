"""Validated snapshots become bounded, deduplicated companion events."""

from __future__ import annotations

import base64
import copy
import hashlib
import threading
import time
import uuid
from collections import OrderedDict, deque
from contextlib import contextmanager
from datetime import datetime, timezone

from protocol import (COMPARISON_MAX_BYTES, EQUIPMENT_MAX_BYTES, LOADOUT_MAX_BYTES, GAME_PROTOCOLS, FrameError, load_json,
                      validate_equipment_fragment, validate_equipment_record, validate_equipment_swap,
                      validate_equipment_offer, validate_comparison_fragment, validate_equipment_comparison,
                      validate_loadout_fragment, validate_equipment_loadout, validate_macro, validate_calendar, validate_group_buff, validate_life,
                      INVENTORY_MAX_BYTES, validate_inventory_fragment, validate_inventory,
                      QUEST_MAX_BYTES, validate_quest_fragment, validate_quests,
                      TALENT_MAX_BYTES, validate_talent_fragment, validate_talents, validate_weapon_skill,
                      validate_loot, validate_pulse, validate_archive_fragment, validate_archive)

from item_storage import ItemStorageAssembler

DEFAULT_CONFIG = {"x": 8, "y": 8, "cellSize": 1, "pollMs": 100, "paused": False}
EQUIPMENT_TTL_SECONDS = 180
EQUIPMENT_PENDING_LIMIT = 8
EQUIPMENT_DEDUP_LIMIT = 256
LOADOUT_TTL_SECONDS = 1200
LOADOUT_PENDING_LIMIT = 2
LOADOUT_PENDING_BYTES = LOADOUT_MAX_BYTES * LOADOUT_PENDING_LIMIT
INVENTORY_TTL_SECONDS = 1200
INVENTORY_PENDING_LIMIT = 2
INVENTORY_PENDING_BYTES = INVENTORY_MAX_BYTES * INVENTORY_PENDING_LIMIT
QUEST_TTL_SECONDS = 1200
QUEST_PENDING_LIMIT = 2
QUEST_PENDING_BYTES = QUEST_MAX_BYTES * QUEST_PENDING_LIMIT
TALENT_TTL_SECONDS = 1200
TALENT_PENDING_LIMIT = 2
TALENT_PENDING_BYTES = TALENT_MAX_BYTES * TALENT_PENDING_LIMIT
LIFE_TTL_SECONDS = 5
WEAPON_SKILL_TTL_SECONDS = 120
WEAPON_SKILL_PENDING_LIMIT = 2
BULK_RECOVERY_SECONDS = 5
ARCHIVE_TTL_SECONDS = 7200
ARCHIVE_PENDING_LIMIT = 8


def known_zone(snapshot: dict) -> tuple[int, str, int | None] | None:
    """A named map or instance can establish a location."""
    zone = snapshot["zone"].strip()
    map_id, instance_id = snapshot["map"], snapshot.get("instanceID")
    if (map_id <= 0 and instance_id is None) or not zone or zone.casefold() in ("当前位置暂不可用", "location unavailable"):
        return None
    return map_id, zone, instance_id


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
        self.item_storage = ItemStorageAssembler(clock, wall_clock)
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
        # Life frames enrich a live snapshot; they never renew its heartbeat.
        # Keep watermarks through capture gaps so a frozen auxiliary frame cannot revive progress.
        self.life_identity = None
        self.life_login = None
        self.life_tick = None
        self.life_count = None
        self.life_at = None
        self.life_managed = False
        self.error = f"等待插件的 {self.protocol} 遥测网格"
        self.demo = False
        self.reset_baseline = True
        self.last_known_zone: tuple[int, str, int | None] | None = None
        self.frame_bmp: bytes | None = None
        self.equipment = deque(maxlen=10)
        self.equipment_error: str | None = None
        self.equipment_pending: dict[int, dict] = {}
        self.equipment_seen: OrderedDict[int, int] = OrderedDict()
        self.equipment_rejected: OrderedDict[int, float] = OrderedDict()
        self.equipment_swaps: list[dict] = []
        self.equipment_swap_error: str | None = None
        self.equipment_swap_seen: OrderedDict[int, dict] = OrderedDict()
        self.equipment_swap_floor = 0
        self.equipment_offer: dict | None = None
        self.equipment_offer_error: str | None = None
        self.equipment_offer_expires = 0.0
        self.group_buff_sequence = None
        self.group_buff = None
        self.group_buff_at = None
        self.calendar_at = None
        self.calendar = None
        self.calendar_parts = {}
        self.calendar_key = None
        self.macro_import = None
        self.macro_import_at = None
        # Comparison fragments have separate queues and error state. They cannot evict item observations or refresh their heartbeat.
        self.equipment_comparisons: list[dict] = []
        self.equipment_comparison_error: str | None = None
        self.comparison_pending: dict[int, dict] = {}
        self.comparison_seen: OrderedDict[int, int] = OrderedDict()
        self.comparison_rejected: OrderedDict[int, float] = OrderedDict()
        self.comparison_floor = 0
        self.equipment_loadout: dict | None = None
        self.equipment_loadout_error: str | None = None
        self.loadout_pending: dict[int, dict] = {}
        self.loadout_rejected: OrderedDict[int, float] = OrderedDict()
        self.loadout_parts: dict[int, bytes] = {}
        self.loadout_count = 0
        self.inventory: dict | None = None
        self.inventory_received_at: str | None = None
        self.inventory_error: str | None = None
        self.inventory_pending: dict[int, dict] = {}
        self.inventory_rejected: OrderedDict[int, float] = OrderedDict()
        self.inventory_parts: dict[int, bytes] = {}
        self.inventory_count = 0
        self.quests: dict | None = None
        self.quests_received_at: str | None = None
        self.quests_error: str | None = None
        self.quests_pending: dict[int, dict] = {}
        self.quests_rejected: OrderedDict[int, float] = OrderedDict()
        self.quests_parts: dict[int, bytes] = {}
        self.quests_count = 0
        self.talents: dict | None = None
        self.talents_received_at: str | None = None
        self.talents_error: str | None = None
        self.talents_pending: dict[int, dict] = {}
        self.talents_rejected: OrderedDict[int, float] = OrderedDict()
        self.talents_parts: dict[int, bytes] = {}
        self.talents_count = 0
        self.weapon_skills: dict | None = None
        self.weapon_skills_at: float | None = None
        self.weapon_skills_error: str | None = None
        self.weapon_skills_identity = None
        self.weapon_skills_floor = 0
        self.weapon_skills_not_before = 0.0
        self.weapon_skills_pending: dict[int, dict] = {}
        self.weapon_skills_parts: dict[int, dict] = {}
        self.capture_revision = 0
        self.connection = {"phase": "locating", "reason": None, "attempts": 0, "consecutive": 0,
                           "lastFrameAt": None, "calibratedAt": None, "retrySeconds": 0, "calibration": None}
        self.transfer_results = {}
        self.transfer_latest = {}
        self.calendar_started = None
        self._verified_source = None
        self._reported_source = None
        self._bulk_recovery = None
        # Compact pulses depend on the full profile from this physical client.
        self._profile_source = None
        self._profile_observed_at: int | None = None
        self._pulse_active = False
        self._reset_archive()
        self._needs_profile = False
        self._low_health_id = 0
        self._level_gate_id = 0
        self._loot_max = 0
        self._loot_seen: set[int] = set()

    def _valid_source(self, source_token) -> bool:
        return (isinstance(source_token, tuple) and len(source_token) == 3
                and source_token[0] == self.game and isinstance(source_token[1], tuple)
                and len(source_token[1]) == 3 and all(type(value) is int and value > 0 for value in source_token[1])
                and source_token[2] == (self.config["x"], self.config["y"], self.config["cellSize"], self.protocol))

    def _recovery_matches(self, source_token) -> bool:
        saved = self._bulk_recovery
        return (saved is not None and self._valid_source(source_token) and source_token == saved["source"]
                and self.config == saved["config"] and self.capture_revision == saved["revision"]
                and 0 <= self.clock() - saved["heartbeat_at"] <= BULK_RECOVERY_SECONDS)

    def _profile_matches_source(self) -> bool:
        # Calibration can change without changing the physical game window.
        reported, profile = self._reported_source, self._profile_source
        if reported is None or profile is None:
            return reported is profile
        return reported[:2] == profile[:2]

    def report_connection(self, diagnostic: dict, *, source_token=None, transient=False) -> None:
        with self.lock:
            self._reported_source = source_token if self._valid_source(source_token) else None
            if self._bulk_recovery is not None and (not self._recovery_matches(source_token)
                    or diagnostic["phase"] == "connected" and diagnostic.get("reason") is not None):
                self._clear_equipment(preserve_loadout=self._low_frequency and self._profile_matches_source())
            if (self._bulk_recovery is None and transient and diagnostic["phase"] == "locating"
                    and diagnostic.get("reason") == "grid-unreadable" and self.connection["phase"] == "connected"
                    and self._status() == "live" and not self.error and not self.demo and not self.reset_baseline
                    and self._valid_source(source_token) and source_token == self._verified_source):
                self._bulk_recovery = {
                    "source": source_token, "config": dict(self.config), "revision": self.capture_revision,
                    "heartbeat_at": self.fresh_at, "tick": self.last_tick,
                    "identity": (self.game, self.snapshot["account"], self.snapshot["guid"], self.snapshot["session"])}
            self.connection = copy.deepcopy(diagnostic)
            if diagnostic["phase"] != "connected":
                preserve = (self._recovery_matches(source_token) and transient
                            and diagnostic["phase"] in ("locating", "validating")
                            and diagnostic.get("reason") in (None, "grid-unreadable"))
                reason = diagnostic.get("reason")
                same_window_gap = (diagnostic["phase"] == "validating" or transient
                                   or reason in ("window-minimized", "window-hidden", "window-missing"))
                self._clear_equipment(preserve_bulk=preserve, preserve_loadout=(
                    self._pulse_active and same_window_gap and self._profile_matches_source()))
                self.life_at = None
                self.fresh_at = None
                self.reset_baseline = True

    @contextmanager
    def calibration_guard(self, config: dict, revision: int):
        """Order calibration writes against manual changes and retries, without locking during capture or search."""
        with self.lock:
            if self.config != config or self.capture_revision != revision or self.demo or self.config["paused"]:
                raise FrameError("画面读取已作废")
            yield

    def retry_connection(self) -> None:
        with self.lock:
            if self.demo or self.config["paused"]:
                raise ValueError("请先结束演示并取消暂停，再重新定位")
            self.capture_revision += 1
            self._bulk_recovery = None
            self._verified_source = None
            self._reported_source = None
            self._clear_weapon_skills()
            self.equipment_pending.clear()
            self.comparison_pending.clear()
            if not self._pulse_active:
                self.loadout_pending.clear()
                self.inventory_pending.clear()
            if not self._low_frequency:
                self.quests_pending.clear()
                self.talents_pending.clear()
                self.item_storage.pending.clear()
            self.transfer_results.clear()
            self.transfer_latest.clear()
            if self.calendar is None:
                self.calendar_key, self.calendar_parts, self.calendar_started = None, {}, None
            self.fresh_at = None
            self.life_at = None
            self.last_tick = None
            self.reset_baseline = True
            self.connection = {"phase": "locating", "reason": None, "attempts": 0, "consecutive": 0,
                               "lastFrameAt": None, "calibratedAt": None, "retrySeconds": 0, "calibration": None}

    def _transfer(self, kind: str, count: int, received: int, phase: str, started: float) -> dict:
        ttl = LOADOUT_TTL_SECONDS if kind == "gear" else EQUIPMENT_TTL_SECONDS
        return {"kind": kind, "phase": phase, "received": received, "total": count,
                "elapsedSeconds": round(max(0, self.clock() - started), 1), "timeoutSeconds": ttl}

    def _record_transfer(self, kind: str, value: dict) -> None:
        count = value.get("n")
        if type(count) is not int or not 0 <= count <= 820:
            return
        if kind == "calendar":
            if self.calendar_key != (value.get("s"), value.get("g"), value.get("day"), count):
                return
            received = len(self.calendar_parts)
            started = self.calendar_started if self.calendar_started is not None else self.clock()
            phase = "complete" if self.calendar is not None else "receiving"
        else:
            if type(value.get("id")) is not int:
                return
            if (not self.snapshot or (value.get("s"), value.get("g")) != (self.snapshot["session"], self.snapshot["guid"])
                    or value["id"] < self.transfer_latest.get(kind, -1)):
                return
            pending, completed = {
                "eq": (self.equipment_pending, self.equipment_seen),
                "cmp": (self.comparison_pending, self.comparison_seen),
                "gear": (self.loadout_pending, {self.equipment_loadout["id"]} if self.equipment_loadout else set()),
            }[kind]
            item = pending.get(value.get("id"))
            if item:
                received, count, started, phase = len(item["parts"]), item["count"], item["started"], "receiving"
            elif value.get("id") in completed:
                count = self.loadout_count if kind == "gear" else completed[value["id"]]
                received, started, phase = count, self.clock(), "complete"
            else:
                received, started, phase = 0, self.clock(), "error"
            self.transfer_latest[kind] = value["id"]
        self.transfer_results[kind] = self._transfer(kind, max(1, count), received, phase, started)

    def _transfers(self) -> list[dict]:
        results = copy.deepcopy(self.transfer_results)
        for kind, entries in (("eq", self.equipment_pending), ("cmp", self.comparison_pending), ("gear", self.loadout_pending)):
            if entries:
                latest = max(entries.values(), key=lambda item: item["started"])
                results[kind] = self._transfer(kind, latest["count"], len(latest["parts"]), "receiving", latest["started"])
        if self.calendar_started is not None and self.calendar is None and self.calendar_key:
            results["calendar"] = self._transfer("calendar", self.calendar_key[3], len(self.calendar_parts), "receiving", self.calendar_started)
        return list(results.values())

    def _clear_equipment(self, *, preserve_bulk=False, preserve_loadout=False) -> None:
        self._clear_weapon_skills()
        preserve_low_frequency = self._low_frequency and preserve_loadout
        if not preserve_bulk:
            self._bulk_recovery = None
            if not preserve_low_frequency:
                self.item_storage.reset()
        self.transfer_results.clear()
        self.transfer_latest.clear()
        self.calendar_started = None
        self.group_buff = None
        self.group_buff_at = None
        self.calendar_at = None
        self.calendar = None
        self.calendar_parts = {}
        self.calendar_key = None
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
        if preserve_bulk or preserve_low_frequency:
            return
        if not preserve_loadout:
            self.equipment_loadout = None
            self.equipment_loadout_error = None
            self.loadout_pending.clear()
            self.loadout_rejected.clear()
            self.loadout_parts.clear()
            self.loadout_count = 0
            self.inventory = None
            self.inventory_received_at = None
            self.inventory_error = None
            self.inventory_pending.clear()
            self.inventory_rejected.clear()
            self.inventory_parts.clear()
            self.inventory_count = 0
        self.quests = None
        self.quests_received_at = None
        self.quests_error = None
        self.quests_pending.clear()
        self.quests_rejected.clear()
        self.quests_parts.clear()
        self.quests_count = 0
        self.talents = None
        self.talents_received_at = None
        self.talents_error = None
        self.talents_pending.clear()
        self.talents_rejected.clear()
        self.talents_parts.clear()
        self.talents_count = 0

    def _clear_weapon_skills(self) -> None:
        identity = ((self.snapshot["session"], self.snapshot["guid"])
                    if self.snapshot is not None else None)
        if identity != self.weapon_skills_identity:
            self.weapon_skills_identity = identity
            self.weapon_skills_floor = 0
            self.weapon_skills_not_before = 0.0
        elif self.weapon_skills is not None or self.weapon_skills_pending:
            # Preserve revision watermarks across reconnects of the same game session.
            # A new observation must also postdate the reset, not a cached unseen part.
            self.weapon_skills_floor = max([self.weapon_skills_floor, *self.weapon_skills_pending])
            self.weapon_skills_not_before = max(self.weapon_skills_not_before, self.wall_clock())
        self.weapon_skills = None
        self.weapon_skills_at = None
        self.weapon_skills_error = None
        self.weapon_skills_pending.clear()
        self.weapon_skills_parts.clear()

    def _retire_weapon_skills(self, identifier: int) -> None:
        # Completed, conflicting, timed-out and evicted revisions cannot restart.
        self.weapon_skills_floor = max(self.weapon_skills_floor, identifier)
        self.weapon_skills_pending = {revision: pending for revision, pending in self.weapon_skills_pending.items()
                                      if revision > self.weapon_skills_floor}

    def _ingest_weapon_skills(self, value: dict) -> None:
        if (self.demo or self._status() != "live" or self.reset_baseline or self.error
                or self.snapshot is None or not self.snapshot["online"]):
            return
        try:
            fragment = validate_weapon_skill(value)
            if (fragment["s"], fragment["g"]) != (self.snapshot["session"], self.snapshot["guid"]):
                return
            identifier = fragment["id"]
            latest = self.weapon_skills
            if latest is not None and identifier == latest["id"]:
                if self.weapon_skills_parts.get(fragment["p"]) != fragment:
                    self.weapon_skills = None
                    self.weapon_skills_at = None
                    self.weapon_skills_parts.clear()
                    self.weapon_skills_error = "Conflicting completed weapon-skill revision discarded"
                return
            if identifier <= self.weapon_skills_floor:
                return
            if (not self.wall_clock() - WEAPON_SKILL_TTL_SECONDS <= fragment["t"] <= self.wall_clock() + 120
                    or fragment["t"] <= self.weapon_skills_not_before):
                self._retire_weapon_skills(identifier)
                raise FrameError("Weapon-skill observation is expired, future-dated or predates reconnect")
            self._expire_equipment()
            if identifier <= self.weapon_skills_floor:
                return
            pending = self.weapon_skills_pending.get(identifier)
            if pending is None:
                if len(self.weapon_skills_pending) >= WEAPON_SKILL_PENDING_LIMIT:
                    oldest = min(self.weapon_skills_pending)
                    if identifier < oldest:
                        return
                    self._retire_weapon_skills(oldest)
                pending = {"started": self.clock(), "metadata": (fragment["n"], fragment["t"], fragment["status"]), "parts": {}}
                self.weapon_skills_pending[identifier] = pending
            part = fragment["p"]
            if (pending["metadata"] != (fragment["n"], fragment["t"], fragment["status"])
                    or part in pending["parts"] and pending["parts"][part] != fragment):
                self._retire_weapon_skills(identifier)
                raise FrameError("Conflicting weapon-skill parts discarded")
            pending["parts"][part] = copy.deepcopy(fragment)
            if len(pending["parts"]) != fragment["n"]:
                return
            entries = [pending["parts"][index]["entry"] for index in range(1, fragment["n"] + 1)
                       if pending["parts"][index]["entry"] is not None]
            if len({entry["skillLineID"] for entry in entries}) != len(entries):
                self._retire_weapon_skills(identifier)
                raise FrameError("Duplicate weapon skill in one revision")
            self._retire_weapon_skills(identifier)
            self.weapon_skills = {"v": 1, "id": identifier, "session": fragment["s"], "guid": fragment["g"],
                                  "observedAt": fragment["t"], "status": fragment["status"], "entries": copy.deepcopy(entries)}
            self.weapon_skills_at = self.clock()
            self.weapon_skills_parts = copy.deepcopy(pending["parts"])
            self.weapon_skills_error = None
        except FrameError as exc:
            self.weapon_skills_error = str(exc)

    def _current_weapon_skills(self, status: str) -> dict | None:
        record = self.weapon_skills
        if (status != "live" or self.demo or self.error or self.reset_baseline
                or self.snapshot is None or not self.snapshot["online"] or record is None
                or self.weapon_skills_at is None or self.clock() - self.weapon_skills_at >= WEAPON_SKILL_TTL_SECONDS
                or (record["session"], record["guid"]) != (self.snapshot["session"], self.snapshot["guid"])
                or not self.wall_clock() - WEAPON_SKILL_TTL_SECONDS <= record["observedAt"] <= self.wall_clock() + 120):
            return None
        return copy.deepcopy(record)

    def _reject_equipment(self, identifier: int) -> None:
        self.equipment_pending.pop(identifier, None)
        self.equipment_rejected[identifier] = self.clock() + EQUIPMENT_TTL_SECONDS
        while len(self.equipment_rejected) > EQUIPMENT_DEDUP_LIMIT:
            self.equipment_rejected.popitem(last=False)

    def _expire_equipment(self) -> None:
        now = self.clock()
        for identifier, pending in list(self.weapon_skills_pending.items()):
            if now - pending["started"] >= WEAPON_SKILL_TTL_SECONDS:
                self._retire_weapon_skills(identifier)
                self.weapon_skills_error = "Weapon-skill observation parts expired"
        for identifier, expires in list(self.inventory_rejected.items()):
            if expires <= now:
                del self.inventory_rejected[identifier]
        for identifier, pending in list(self.inventory_pending.items()):
            if now - pending["started"] >= INVENTORY_TTL_SECONDS:
                del self.inventory_pending[identifier]
                self.inventory_error = "背包库存分片等待超时，未完成快照已丢弃"
        for identifier, expires in list(self.loadout_rejected.items()):
            if expires <= now:
                del self.loadout_rejected[identifier]
        for identifier, pending in list(self.loadout_pending.items()):
            if now - pending["started"] >= LOADOUT_TTL_SECONDS:
                self.transfer_results["gear"] = self._transfer("gear", pending["count"], len(pending["parts"]), "timed-out", pending["started"])
                del self.loadout_pending[identifier]
                self.equipment_loadout_error = "当前装备分片等待超时，已丢弃未完成快照"
        for identifier, expires in list(self.equipment_rejected.items()):
            if expires <= now:
                del self.equipment_rejected[identifier]
        for identifier, pending in list(self.equipment_pending.items()):
            if now - pending["started"] >= EQUIPMENT_TTL_SECONDS:
                self.transfer_results["eq"] = self._transfer("eq", pending["count"], len(pending["parts"]), "timed-out", pending["started"])
                del self.equipment_pending[identifier]
                self.equipment_error = "装备分片等待超时，已丢弃未完成记录"
        for identifier, expires in list(self.comparison_rejected.items()):
            if expires <= now:
                del self.comparison_rejected[identifier]
        for identifier, pending in list(self.comparison_pending.items()):
            if now - pending["started"] >= EQUIPMENT_TTL_SECONDS:
                self.transfer_results["cmp"] = self._transfer("cmp", pending["count"], len(pending["parts"]), "timed-out", pending["started"])
                del self.comparison_pending[identifier]
                self.equipment_comparison_error = "装备比较分片等待超时，已丢弃未完成记录"
        if (self.calendar_started is not None and self.calendar is None
                and now - self.calendar_started >= EQUIPMENT_TTL_SECONDS):
            self.transfer_results["calendar"] = self._transfer("calendar", self.calendar_key[3], len(self.calendar_parts), "timed-out", self.calendar_started)
            self.calendar_key, self.calendar_parts, self.calendar_started = None, {}, None

        for identifier, expires in list(self.quests_rejected.items()):
            if expires <= now:
                del self.quests_rejected[identifier]
        for identifier, pending in list(self.quests_pending.items()):
            if now - pending["started"] >= QUEST_TTL_SECONDS:
                del self.quests_pending[identifier]
                self.quests_error = "任务分片等待超时，未完成快照已丢弃"

        for identifier, expires in list(self.talents_rejected.items()):
            if expires <= now:
                del self.talents_rejected[identifier]
        for identifier, pending in list(self.talents_pending.items()):
            if now - pending["started"] >= TALENT_TTL_SECONDS:
                del self.talents_pending[identifier]
                self.talents_error = "天赋分片等待超时，未完成快照已丢弃"

    def _reject_loadout(self, identifier: int) -> None:
        self.loadout_pending.pop(identifier, None)
        self.loadout_rejected[identifier] = self.clock() + LOADOUT_TTL_SECONDS
        while len(self.loadout_rejected) > EQUIPMENT_DEDUP_LIMIT:
            self.loadout_rejected.popitem(last=False)

    def _ingest_equipment_loadout(self, value: dict) -> None:
        """Publish a complete revision atomically. Acquisition history stays separate."""
        self._expire_equipment()
        if self.demo or self._status() != "live" or self.reset_baseline:
            if self._pulse_active:
                return
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

    def _reject_inventory(self, identifier: int) -> None:
        self.inventory_pending.pop(identifier, None)
        self.inventory_rejected[identifier] = self.clock() + INVENTORY_TTL_SECONDS
        while len(self.inventory_rejected) > EQUIPMENT_DEDUP_LIMIT:
            self.inventory_rejected.popitem(last=False)

    def _ingest_inventory(self, value: dict) -> None:
        """Only complete transfers replace a revision. Capture completeness stays an independent fact."""
        self._expire_equipment()
        if self.demo or self._status() != "live" or self.reset_baseline or self.error:
            if self._pulse_active:
                return
            self.inventory_pending.clear()
            self.inventory_error = "背包库存需要当前角色的实时状态帧"
            return
        try:
            fragment = validate_inventory_fragment(value)
            identifier = fragment["id"]
            if (fragment["s"], fragment["g"]) != (self.snapshot["session"], self.snapshot["guid"]):
                raise FrameError("忽略其他角色或会话的背包库存分片")
            raw = base64.b64decode(fragment["d"], validate=True)
            latest = self.inventory
            if latest is not None and identifier <= latest["id"]:
                if identifier == latest["id"] and (fragment["n"] != self.inventory_count
                        or self.inventory_parts.get(fragment["p"]) != hashlib.sha256(raw).digest()):
                    raise FrameError("已完成的背包库存修订分片冲突，保留原快照")
                return
            if identifier in self.inventory_rejected:
                return
            pending = self.inventory_pending.get(identifier)
            if pending is None:
                if len(self.inventory_pending) >= INVENTORY_PENDING_LIMIT:
                    oldest = min(self.inventory_pending)
                    if identifier <= oldest:
                        raise FrameError("背包库存在途快照已达 2 条，忽略较旧修订")
                    del self.inventory_pending[oldest]
                pending = {"started": self.clock(), "count": fragment["n"], "parts": {}}
                self.inventory_pending[identifier] = pending
            part = fragment["p"]
            previous = pending["parts"].get(part)
            if pending["count"] != fragment["n"] or (previous is not None and previous != raw):
                self._reject_inventory(identifier)
                raise FrameError("背包库存分片冲突，整套修订已丢弃")
            used = sum(sum(len(chunk) for chunk in item["parts"].values()) for item in self.inventory_pending.values())
            if used + (len(raw) if previous is None else 0) > INVENTORY_PENDING_BYTES:
                self._reject_inventory(identifier)
                raise FrameError("背包库存在途快照超过内存上限")
            pending["parts"][part] = raw
            if len(pending["parts"]) != pending["count"]:
                return
            payload = b"".join(pending["parts"][index] for index in range(1, pending["count"] + 1))
            try:
                record = validate_inventory(load_json(payload))
                if (record["session"], record["guid"], record["id"]) != (fragment["s"], fragment["g"], identifier):
                    raise FrameError("背包库存快照与分片身份不一致")
                if (record["observedAt"] > self.wall_clock() + 120
                        or not self._low_frequency and record["observedAt"] < self.wall_clock() - INVENTORY_TTL_SECONDS):
                    raise FrameError("背包库存采集时间过期或超前")
            except FrameError:
                self._reject_inventory(identifier)
                raise
            self.inventory = copy.deepcopy(record)
            self.inventory_received_at = datetime.fromtimestamp(self.wall_clock(), timezone.utc).isoformat(timespec="milliseconds")
            self.inventory_parts = {index: hashlib.sha256(chunk).digest() for index, chunk in pending["parts"].items()}
            self.inventory_count = pending["count"]
            self.inventory_pending = {revision: item for revision, item in self.inventory_pending.items() if revision > identifier}
            self.inventory_error = None
        except FrameError as exc:
            self.inventory_error = str(exc)

    def _current_inventory(self, status: str) -> dict | None:
        # Stale, paused, demo, foreign, and superseded captures cannot supply automatic task observations.
        if (status != "live" or self.demo or self.error or self.inventory_error or not self.inventory
                or not self.snapshot or not self.snapshot["online"] or self.reset_baseline
                or (self.inventory["session"], self.inventory["guid"]) != (self.snapshot["session"], self.snapshot["guid"])
                or (not self._low_frequency and not self.wall_clock() - INVENTORY_TTL_SECONDS <= self.inventory["observedAt"] <= self.wall_clock() + 120)
                or any(revision > self.inventory["id"] for revision in self.inventory_pending)):
            return None
        return copy.deepcopy(self.inventory)

    def _reject_quests(self, identifier: int) -> None:
        self.quests_pending.pop(identifier, None)
        self.quests_rejected[identifier] = self.clock() + QUEST_TTL_SECONDS
        while len(self.quests_rejected) > EQUIPMENT_DEDUP_LIMIT:
            self.quests_rejected.popitem(last=False)

    def _ingest_quests(self, value: dict) -> None:
        """Only complete transfers replace a revision. Capture completeness stays an independent fact."""
        self._expire_equipment()
        if self.demo or self._status() != "live" or self.reset_baseline or self.error:
            if self._low_frequency:
                return
            self.quests_pending.clear()
            self.quests_error = "任务需要当前角色的实时状态帧"
            return
        try:
            fragment = validate_quest_fragment(value)
            identifier = fragment["id"]
            if (fragment["s"], fragment["g"]) != (self.snapshot["session"], self.snapshot["guid"]):
                raise FrameError("忽略其他角色或会话的任务分片")
            raw = base64.b64decode(fragment["d"], validate=True)
            latest = self.quests
            if latest is not None and identifier <= latest["id"]:
                if identifier == latest["id"] and (fragment["n"] != self.quests_count
                        or self.quests_parts.get(fragment["p"]) != hashlib.sha256(raw).digest()):
                    raise FrameError("已完成的任务修订分片冲突，保留原快照")
                return
            if identifier in self.quests_rejected:
                return
            pending = self.quests_pending.get(identifier)
            if pending is None:
                if len(self.quests_pending) >= QUEST_PENDING_LIMIT:
                    oldest = min(self.quests_pending)
                    if identifier <= oldest:
                        raise FrameError("任务在途快照已达 2 条，忽略较旧修订")
                    del self.quests_pending[oldest]
                pending = {"started": self.clock(), "count": fragment["n"], "parts": {}}
                self.quests_pending[identifier] = pending
            part = fragment["p"]
            previous = pending["parts"].get(part)
            if pending["count"] != fragment["n"] or (previous is not None and previous != raw):
                self._reject_quests(identifier)
                raise FrameError("任务分片冲突，整套修订已丢弃")
            used = sum(sum(len(chunk) for chunk in item["parts"].values()) for item in self.quests_pending.values())
            if used + (len(raw) if previous is None else 0) > QUEST_PENDING_BYTES:
                self._reject_quests(identifier)
                raise FrameError("任务在途快照超过内存上限")
            pending["parts"][part] = raw
            if len(pending["parts"]) != pending["count"]:
                return
            payload = b"".join(pending["parts"][index] for index in range(1, pending["count"] + 1))
            try:
                record = validate_quests(load_json(payload))
                if (record["session"], record["guid"], record["id"]) != (fragment["s"], fragment["g"], identifier):
                    raise FrameError("任务快照与分片身份不一致")
                if (record["observedAt"] > self.wall_clock() + 120
                        or not self._low_frequency and record["observedAt"] < self.wall_clock() - QUEST_TTL_SECONDS):
                    raise FrameError("任务采集时间过期或超前")
            except FrameError:
                self._reject_quests(identifier)
                raise
            self.quests = copy.deepcopy(record)
            self.quests_received_at = datetime.fromtimestamp(self.wall_clock(), timezone.utc).isoformat(timespec="milliseconds")
            self.quests_parts = {index: hashlib.sha256(chunk).digest() for index, chunk in pending["parts"].items()}
            self.quests_count = pending["count"]
            self.quests_pending = {revision: item for revision, item in self.quests_pending.items() if revision > identifier}
            self.quests_error = None
        except FrameError as exc:
            self.quests_error = str(exc)

    def _current_quests(self, status: str) -> dict | None:
        # Stale, paused, demo, foreign, and superseded captures cannot supply automatic task observations.
        if (status != "live" or self.demo or self.error or self.quests_error or not self.quests
                or not self.snapshot or not self.snapshot["online"] or self.reset_baseline
                or (self.quests["session"], self.quests["guid"]) != (self.snapshot["session"], self.snapshot["guid"])
                or (not self._low_frequency and not self.wall_clock() - QUEST_TTL_SECONDS <= self.quests["observedAt"] <= self.wall_clock() + 120)
                or any(revision > self.quests["id"] for revision in self.quests_pending)):
            return None
        return copy.deepcopy(self.quests)

    def _reject_talents(self, identifier: int) -> None:
        self.talents_pending.pop(identifier, None)
        self.talents_rejected[identifier] = self.clock() + TALENT_TTL_SECONDS
        while len(self.talents_rejected) > EQUIPMENT_DEDUP_LIMIT:
            self.talents_rejected.popitem(last=False)

    def _ingest_talents(self, value: dict) -> None:
        """Only complete transfers replace a revision. Capture completeness stays an independent fact."""
        self._expire_equipment()
        if self.demo or self._status() != "live" or self.reset_baseline or self.error:
            if self._low_frequency:
                return
            self.talents_pending.clear()
            self.talents_error = "天赋需要当前角色的实时状态帧"
            return
        try:
            fragment = validate_talent_fragment(value)
            identifier = fragment["id"]
            if (fragment["s"], fragment["g"]) != (self.snapshot["session"], self.snapshot["guid"]):
                raise FrameError("忽略其他角色或会话的天赋分片")
            raw = base64.b64decode(fragment["d"], validate=True)
            latest = self.talents
            if latest is not None and identifier <= latest["id"]:
                if identifier == latest["id"] and (fragment["n"] != self.talents_count
                        or self.talents_parts.get(fragment["p"]) != hashlib.sha256(raw).digest()):
                    raise FrameError("已完成的天赋修订分片冲突，保留原快照")
                return
            if identifier in self.talents_rejected:
                return
            pending = self.talents_pending.get(identifier)
            if pending is None:
                if len(self.talents_pending) >= TALENT_PENDING_LIMIT:
                    oldest = min(self.talents_pending)
                    if identifier <= oldest:
                        raise FrameError("天赋在途快照已达 2 条，忽略较旧修订")
                    del self.talents_pending[oldest]
                pending = {"started": self.clock(), "count": fragment["n"], "parts": {}}
                self.talents_pending[identifier] = pending
            part = fragment["p"]
            previous = pending["parts"].get(part)
            if pending["count"] != fragment["n"] or (previous is not None and previous != raw):
                self._reject_talents(identifier)
                raise FrameError("天赋分片冲突，整套修订已丢弃")
            used = sum(sum(len(chunk) for chunk in item["parts"].values()) for item in self.talents_pending.values())
            if used + (len(raw) if previous is None else 0) > TALENT_PENDING_BYTES:
                self._reject_talents(identifier)
                raise FrameError("天赋在途快照超过内存上限")
            pending["parts"][part] = raw
            if len(pending["parts"]) != pending["count"]:
                return
            payload = b"".join(pending["parts"][index] for index in range(1, pending["count"] + 1))
            try:
                record = validate_talents(load_json(payload))
                if (record["session"], record["guid"], record["id"]) != (fragment["s"], fragment["g"], identifier):
                    raise FrameError("天赋快照与分片身份不一致")
                if (record["observedAt"] > self.wall_clock() + 120
                        or not self._low_frequency and record["observedAt"] < self.wall_clock() - TALENT_TTL_SECONDS):
                    raise FrameError("天赋采集时间过期或超前")
            except FrameError:
                self._reject_talents(identifier)
                raise
            self.talents = copy.deepcopy(record)
            self.talents_received_at = datetime.fromtimestamp(self.wall_clock(), timezone.utc).isoformat(timespec="milliseconds")
            self.talents_parts = {index: hashlib.sha256(chunk).digest() for index, chunk in pending["parts"].items()}
            self.talents_count = pending["count"]
            self.talents_pending = {revision: item for revision, item in self.talents_pending.items() if revision > identifier}
            self.talents_error = None
        except FrameError as exc:
            self.talents_error = str(exc)

    def _current_talents(self, status: str) -> dict | None:
        if self.talents and self.snapshot:
            if (self.talents["class"] is not None and self.talents["class"] != self.snapshot["class"]
                    or not self._low_frequency and self.talents["specID"] is not None
                    and self.snapshot["spec"] > 0 and self.talents["specID"] != self.snapshot["spec"]
                    or self.game == "retail" and self.talents["configType"] == 4):
                return None
        # Stale, paused, demo, foreign, and superseded captures cannot supply automatic task observations.
        if (status != "live" or self.demo or self.error or self.talents_error or not self.talents
                or not self.snapshot or not self.snapshot["online"] or self.reset_baseline
                or (self.talents["session"], self.talents["guid"]) != (self.snapshot["session"], self.snapshot["guid"])
                or (not self._low_frequency and not self.wall_clock() - TALENT_TTL_SECONDS <= self.talents["observedAt"] <= self.wall_clock() + 120)
                or any(revision > self.talents["id"] for revision in self.talents_pending)):
            return None
        return copy.deepcopy(self.talents)

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
            self.comparison_seen[identifier] = fragment["n"]
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
            self.equipment_seen[identifier] = fragment["n"]
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

    def _sync_life_identity(self, snapshot: dict) -> None:
        if self.demo:
            return
        identity = (snapshot["account"], snapshot["session"], snapshot["guid"])
        if identity != self.life_identity:
            self.life_identity = identity
            self.life_login, self.life_tick, self.life_count = None, None, None
            self.life_at, self.life_managed = None, False
        if not snapshot["online"]:
            self.life_at = None
        # An older auxiliary observation cannot lower an inline counter already observed.
        if self.life_managed and "loginId" in snapshot:
            if snapshot["loginId"] != self.life_login:
                self.life_at = None
            elif self.life_count is not None:
                self.life_count = max(self.life_count, snapshot["combatEnds"])

    def _ingest_life(self, snapshot: dict) -> None:
        value = validate_life(snapshot)
        if self.demo or self._status() != "live" or self.reset_baseline or self.error:
            return
        base = self.snapshot
        if not base or not base["online"] or (value["s"], value["g"]) != (base["session"], base["guid"]):
            return
        # Alternate state/data slots can put the life tick one step ahead of the latest state.
        if not base["tick"] - 5 <= value["t"] <= base["tick"] + 1:
            return
        self._sync_life_identity(base)
        expected_login = self.life_login or base.get("loginId") or value["l"]
        self.life_managed = True
        self.life_login = expected_login
        if value["l"] != expected_login or base.get("loginId", expected_login) != expected_login:
            self.life_at = None
            return
        if self.life_tick is not None and value["t"] <= self.life_tick:
            return
        minimum_count = self.life_count if self.life_count is not None else 0
        if base.get("loginId") == expected_login:
            minimum_count = max(minimum_count, base["combatEnds"])
        if value["c"] < minimum_count:
            return
        self.life_tick, self.life_count, self.life_at = value["t"], value["c"], self.clock()

    def _merge_life(self, snapshot: dict | None, status: str) -> None:
        if snapshot is None:
            return
        if status != "live" or self.demo or self.error or self.reset_baseline or not snapshot["online"]:
            self.life_at = None
            snapshot.pop("loginId", None)
            snapshot.pop("combatEnds", None)
            return
        if not self.life_managed:
            return  # Older v3 addons may provide the pair directly in the state frame.
        snapshot.pop("loginId", None)
        snapshot.pop("combatEnds", None)
        if self.life_at is None:
            return
        if self.clock() - self.life_at > LIFE_TTL_SECONDS:
            self.life_at = None
            return
        snapshot["loginId"], snapshot["combatEnds"] = self.life_login, self.life_count

    def _reset_archive(self) -> None:
        self._low_frequency = False
        self._archive: dict[str, dict] = {}
        self._archive_pending: dict[int, dict] = {}
        self._archive_retired: OrderedDict[int, None] = OrderedDict()
        self.archive_error: str | None = None

    def _archive_live(self, status: str) -> bool:
        return (status == "live" and not self.demo and not self.reset_baseline and not self.error
                and self.snapshot is not None and self.snapshot["online"] and self._profile_matches_source())

    def _retire_archive(self, identifier: int) -> None:
        self._archive_pending.pop(identifier, None)
        self._archive_retired[identifier] = None
        if len(self._archive_retired) > EQUIPMENT_DEDUP_LIMIT:
            self._archive_retired.popitem(last=False)

    def _ingest_archive(self, value: dict) -> None:
        if not self._archive_live(self._status()):
            return
        try:
            fragment = validate_archive_fragment(value)
            identity = (fragment["s"], fragment["g"])
            if identity != (self.snapshot["session"], self.snapshot["guid"]):
                return
            now = self.clock()
            for revision, pending in list(self._archive_pending.items()):
                if now - pending["started"] > ARCHIVE_TTL_SECONDS:
                    self._retire_archive(revision)
            identifier = fragment["id"]
            if identifier in self._archive_retired or any(record["id"] == identifier for record in self._archive.values()):
                return
            if identifier not in self._archive_pending:
                if len(self._archive_pending) >= ARCHIVE_PENDING_LIMIT:
                    self._retire_archive(min(self._archive_pending))
                self._archive_pending[identifier] = {"started": now, "count": fragment["n"], "parts": {}}
            pending = self._archive_pending[identifier]
            part = fragment["p"]
            raw = base64.b64decode(fragment["d"])
            if pending["count"] != fragment["n"] or (part in pending["parts"] and pending["parts"][part] != raw):
                self._retire_archive(identifier)
                raise FrameError("角色快照分片冲突，已丢弃该修订")
            pending["parts"][part] = raw
            if len(pending["parts"]) != pending["count"]:
                return
            self._retire_archive(identifier)
            body = b"".join(pending["parts"][index] for index in range(1, pending["count"] + 1))
            record = validate_archive(load_json(body))
            if (record["session"], record["guid"], record["id"]) != (*identity, identifier):
                raise FrameError("角色快照与分片标识不一致")
            if record["observedAt"] > self.wall_clock() + 120:
                raise FrameError("角色快照采集时间超前")
            section = record["section"]
            previous = self._archive.get(section)
            if previous and (record["id"] <= previous["id"] or record["observedAt"] < previous["observedAt"]):
                return
            self._archive[section] = record
            self._low_frequency = True
            self.archive_error = None
        except FrameError as exc:
            self.archive_error = str(exc)

    def view(self, after: int | None = None) -> dict:
        with self.lock:
            if self._bulk_recovery is not None and not self._recovery_matches(self._reported_source):
                self._clear_equipment()
            self._expire_equipment()
            age = round(max(0, self.clock() - self.fresh_at), 2) if self.fresh_at is not None else None
            status = self._status()
            current_snapshot = copy.deepcopy(self.snapshot)
            self._merge_life(current_snapshot, status)
            if current_snapshot is not None:
                if self._pulse_active and self._profile_observed_at is not None:
                    current_snapshot["profileObservedAt"] = self._profile_observed_at
                current_snapshot.pop("weaponSkills", None)
                weapon_skills = self._current_weapon_skills(status)
                if weapon_skills is not None:
                    current_snapshot["weaponSkills"] = weapon_skills
            # Keep event observations historical. An expired or paused current
            # view must not present the last recorded position as live.
            if current_snapshot is not None and status not in ("live", "demo"):
                current_snapshot.pop("loginId", None)
                current_snapshot.pop("combatEnds", None)
                current_snapshot["px"], current_snapshot["py"] = None, None
                if "instanceType" in current_snapshot:
                    current_snapshot["instanceType"] = "unknown"
                if "instanceID" in current_snapshot:
                    current_snapshot["instanceID"] = None
            current_inventory = self._current_inventory(status)
            current_quests = self._current_quests(status)
            current_talents = self._current_talents(status)
            current_archive = self._archive if self._archive_live(status) else {}
            section = current_archive.get("schedule")
            calendar = section["data"] if section else None
            if calendar is None and status == "live" and not self.demo and not self.error and self.calendar_at is not None:
                if self.clock() - self.calendar_at < 70:
                    calendar = self.calendar
            archive_state = {"lowFrequency": True, "archive": copy.deepcopy(current_archive)} if self._low_frequency else {}
            if self.archive_error is not None:
                archive_state["archiveError"] = self.archive_error
            needs_profile = {"needsProfile": True} if self._needs_profile and status == "waiting" else {}
            return {"instanceId": self.instance_id, "status": status, "source": "demo" if self.demo else "screen", "snapshot": current_snapshot,
                    **needs_profile, **archive_state,
                    "lastSeen": self.last_seen, "ageSeconds": age, "itemStorageRevision": self.item_storage.sequence,
                    "itemStorageError": self.item_storage.error,
                    "eventCursor": self.event_id,
                    "events": copy.deepcopy([e for e in self.events if after is None or e["id"] > after]),
                    "config": dict(self.config), "error": self.error if status != "live" else None,
                    "connection": copy.deepcopy(self.connection), "transfers": self._transfers(),
                    "equipment": copy.deepcopy(list(self.equipment)), "equipmentError": self.equipment_error,
                    "equipmentSwaps": copy.deepcopy(self.equipment_swaps), "equipmentSwapError": self.equipment_swap_error,
                    "equipmentOffer": copy.deepcopy(self.equipment_offer) if status == "live" and not self.demo
                    and self.clock() < self.equipment_offer_expires else None,
                    "equipmentOfferError": self.equipment_offer_error,
                    "groupBuff": copy.deepcopy(self.group_buff) if status == "live" and not self.demo and not self.error
                    and self.group_buff_at is not None and self.clock() - self.group_buff_at < 6
                    and current_snapshot and current_snapshot["online"] and not current_snapshot["combat"] and not current_snapshot["dead"]
                    and current_snapshot.get("instanceType") == self.group_buff["instanceType"]
                    and current_snapshot.get("instanceID") == self.group_buff["instanceID"] else None,
                    "calendar": copy.deepcopy(calendar),
                    "macroImport": copy.deepcopy(self.macro_import) if status == "live" and not self.demo
                    and not self.error and self.macro_import_at is not None and self.clock() - self.macro_import_at < 2.5 else None,
                    "equipmentComparisons": copy.deepcopy(self.equipment_comparisons),
                    "equipmentComparisonError": self.equipment_comparison_error,
                    "equipmentLoadout": copy.deepcopy(self.equipment_loadout) if self._bulk_recovery is None
                    and (not self._pulse_active or status == "live") else None,
                    "equipmentLoadoutError": self.equipment_loadout_error,
                    "inventory": current_inventory,
                    "inventoryReceivedAt": self.inventory_received_at if current_inventory is not None else None,
                    "inventoryError": self.inventory_error,
                    "quests": current_quests,
                    "questsReceivedAt": self.quests_received_at if current_quests is not None else None,
                    "questsError": self.quests_error,
                    "talents": current_talents,
                    "talentsReceivedAt": self.talents_received_at if current_talents is not None else None,
                    "talentsError": self.talents_error,
                    "staleAfterSeconds": 5, "protocol": self.protocol, "game": self.game}

    def read_item_storage(self, after: int) -> dict:
        with self.lock:
            if self._bulk_recovery is not None or (self._low_frequency and not self._archive_live(self._status())):
                return {"cursor": after, "record": None, "hasMore": False}
            return self.item_storage.read(after)

    def _event(self, kind: str, title: str, detail: str, snapshot: dict, **metadata) -> None:
        self.event_id += 1
        self.events.append({"id": self.event_id, "type": kind, "timestamp": utc_now(), "title": title,
                            "detail": detail, "snapshot": copy.deepcopy(snapshot), "demo": self.demo, **metadata})

    def _pulse_snapshot(self, value: dict) -> dict | None:
        if self.demo or self.config["paused"]:
            return None
        base = self.snapshot
        if (base is None or (value["s"], value["g"]) != (base["session"], base["guid"])
                or not self._profile_matches_source()):
            if not self._needs_profile:
                self._clear_equipment()
            self._needs_profile = True
            self.fresh_at = None
            self.life_at = None
            self.reset_baseline = True
            self.error = "请在游戏内输入 /reload，同步角色资料"
            return None
        if value["t"] < base["tick"] or value["q"] < base["seq"]:
            return None
        if value["t"] == base["tick"] and (self.fresh_at is None or self._status() == "stale"):
            return None
        self._pulse_active = True
        self._low_frequency = self._low_frequency or value.get("lf", False)
        # Position belongs to an arrival observation. A heartbeat without an
        # arrival must not make an old coordinate look current.
        return {**base, "px": None, "py": None, **value.get("p", {}), "seq": value["q"],
                "tick": value["t"], "online": value["on"], "combat": value["c"], "dead": value["d"]}

    def _record_zone(self, snapshot: dict) -> None:
        zone = known_zone(snapshot)
        if zone is not None and (self._pulse_active or zone[0] > 0):
            # A loading screen does not establish a new region.
            previous = self.last_known_zone
            if previous is not None:
                same_map = zone[0] == previous[0]
                same_instance = zone[2] == previous[2]
                # Login and compact frames can use different UTF-8 name budgets.
                if self._pulse_active:
                    same_map = same_map or (zone[2] is not None and min(zone[0], previous[0]) == 0)
                    changed = not (same_map and same_instance)
                else:
                    changed = zone[:2] != previous[:2]
                if changed:
                    self._event("zone", "进入新区域", f"当前区域：{snapshot['zone']}", snapshot)
            self.last_known_zone = zone

    def _record_pulse_events(self, snapshot: dict, old: dict, health: dict | None, warning: dict | None) -> None:
        self._record_zone(snapshot)
        if snapshot["dead"] and not old["dead"]:
            self._event("death", "角色倒下", "角色已死亡", snapshot)
        if health is not None and health["id"] > self._low_health_id:
            self._low_health_id = health["id"]
            if snapshot["combat"] and not snapshot["dead"]:
                percent = health["percent"]
                observation = dict(snapshot)
                self._merge_life(observation, self._status())
                self._event("low_health", "战斗中生命过低", f"当前生命值降至 {percent}%", observation,
                            healthPercent=percent)
        if (self.game == "forever" and warning is not None and warning["id"] > self._level_gate_id
                and snapshot["map"] == warning["map"] and snapshot.get("instanceType") == "none" and not snapshot["dead"]):
            self._level_gate_id = warning["id"]
            self._event("level_gate", "区域等级提醒", "前面的区域，以后再来探索吧", snapshot,
                        playerLevel=warning["level"], minimumLevel=warning["min"])

    def _ingest_loot(self, snapshot: dict) -> None:
        value = validate_loot(snapshot)
        base = self.snapshot
        if (self.demo or self._status() != "live" or self.reset_baseline or self.error
                or not base or not self._profile_matches_source()
                or (value["s"], value["g"]) != (base["session"], base["guid"])):
            return
        identifier = value["id"]
        if identifier in self._loot_seen or identifier <= self._loot_max - EQUIPMENT_DEDUP_LIMIT:
            return
        if identifier > self._loot_max:
            self._loot_max = identifier
            self._loot_seen = {seen for seen in self._loot_seen if seen > identifier - EQUIPMENT_DEDUP_LIMIT}
        self._loot_seen.add(identifier)
        label = value["name"] or f"物品 #{value['item']}"
        self._event("loot", "获得新物品", f"{label} ×{value['n']}", base,
                    itemId=value["item"], itemName=value["name"], quantity=value["n"])

    def ingest(self, snapshot: dict) -> None:
        with self.lock:
            kind = snapshot.get("kind")
            pulse = kind == "pulse"
            if kind and not pulse and self._bulk_recovery is not None:
                return
            health = warning = None
            if pulse:
                value = validate_pulse(snapshot)
                health = value.get("h")
                warning = value.get("w")
                snapshot = self._pulse_snapshot(value)
                if snapshot is None:
                    return
            elif kind == "loot":
                self._ingest_loot(snapshot)
                return
            if snapshot.get("kind") == "wskill":
                self._ingest_weapon_skills(snapshot)
                return
            if snapshot.get("kind") == "life":
                self._ingest_life(snapshot)
                return
            if kind == "archive":
                self._ingest_archive(snapshot)
                return
            if snapshot.get("kind") == "store":
                if not self.demo and self._status() == "live" and not self.reset_baseline and not self.error:
                    self.item_storage.ingest(snapshot, self.snapshot)
                return
            if snapshot.get("kind") == "buff":
                value = validate_group_buff(snapshot)
                if self.demo or self._status() != "live" or self.reset_baseline or self.error:
                    return
                if (value["s"], value["g"]) != (self.snapshot["session"], self.snapshot["guid"]):
                    return
                # A frozen grid cannot renew freshness. A newer clear supersedes any missing-buff observation.
                if self.group_buff_sequence and self.group_buff_sequence[:2] == (value["s"], value["g"]) and value["q"] <= self.group_buff_sequence[2]:
                    return
                self.group_buff_sequence = (value["s"], value["g"], value["q"])
                self.group_buff, self.group_buff_at = value, self.clock()
                return
            if snapshot.get("kind") == "calendar":
                value = validate_calendar(snapshot)
                if self.demo or self._status() != "live" or self.reset_baseline or self.error:
                    return
                if (value["s"], value["g"]) != (self.snapshot["session"], self.snapshot["guid"]):
                    return
                key = (value["s"], value["g"], value["day"], value["n"])
                if self.calendar_key != key:
                    self.calendar_key, self.calendar_parts, self.calendar = key, {}, None
                    self.calendar_started = self.clock()
                self.calendar_at = self.clock()
                self.calendar_parts[value["p"]] = {k: value[k] for k in ("title", "action", "when")}
                if len(self.calendar_parts) == max(1, value["n"]):
                    self.calendar = {"day": value["day"], "items": [self.calendar_parts[i] for i in range(1, value["n"] + 1)]}
                self._record_transfer("calendar", value)
                return
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
            if snapshot.get("kind") == "qlog":
                self._ingest_quests(snapshot)
                return
            if snapshot.get("kind") == "traits":
                self._ingest_talents(snapshot)
                return
            if snapshot.get("kind") == "inv":
                self._ingest_inventory(snapshot)
                return
            if snapshot.get("kind") == "gear":
                self._ingest_equipment_loadout(snapshot)
                self._record_transfer("gear", snapshot)
                return
            if snapshot.get("kind") == "cmp":
                self._ingest_equipment_comparison(snapshot)
                self._record_transfer("cmp", snapshot)
                return
            if snapshot.get("kind") == "eq":
                self._ingest_equipment(snapshot)
                self._record_transfer("eq", snapshot)
                return
            if snapshot.get("kind") == "swap":
                self._ingest_equipment_swap(snapshot)
                return
            if snapshot.get("kind") == "offer":
                self._ingest_equipment_offer(snapshot)
                return
            old = self.snapshot
            identity_changed = (old is None or not self._profile_matches_source()
                                or (old["account"], old["guid"], old["session"])
                                != (snapshot["account"], snapshot["guid"], snapshot["session"]))
            was_stale = self._status() not in ("live", "demo")
            if not identity_changed and old is not None and snapshot["seq"] < old["seq"]:
                if self._bulk_recovery is not None:
                    self._clear_equipment()
                self.error = "忽略旧序号遥测帧"
                return
            resume_bulk = (self._recovery_matches(self._reported_source)
                           and self.connection["phase"] == "connected" and self.connection.get("consecutive", 0) >= 3
                           and snapshot["online"]
                           and self._bulk_recovery["identity"] == (self.game, snapshot["account"], snapshot["guid"], snapshot["session"])
                           and snapshot["tick"] > self._bulk_recovery["tick"])
            tick_changed = identity_changed or self.last_tick != snapshot["tick"]
            if tick_changed:
                self.fresh_at = self.clock()
                self.last_seen = utc_now()
                self.last_tick = snapshot["tick"]
            self.error = "遥测画面已停更，等待新的心跳" if not tick_changed and self._status() == "stale" else None
            # A repeated, frozen frame must never revive a stale state or generate events.
            if not tick_changed and self._status() == "stale":
                self._clear_weapon_skills()
                self.reset_baseline = True
                self.equipment_pending.clear()
                self.comparison_pending.clear()
                self.loadout_pending.clear()
                return
            self.snapshot = copy.deepcopy(snapshot)
            self._verified_source = self._reported_source
            if identity_changed:
                self._pulse_active = False
                self._reset_archive()
                self._low_health_id = 0
                self._level_gate_id = 0
                self._loot_max = 0
                self._loot_seen.clear()
            if not pulse:
                self._profile_source = self._reported_source
                if identity_changed or self._profile_observed_at is None:
                    self._profile_observed_at = int(self.wall_clock() * 1000)
            self._needs_profile = False
            self._sync_life_identity(snapshot)
            if was_stale:
                self.life_at = None
            if self.reset_baseline or identity_changed or was_stale:
                self._clear_equipment(preserve_bulk=resume_bulk,
                                      preserve_loadout=self._pulse_active and not identity_changed)
                self._bulk_recovery = None
                if resume_bulk:
                    self._expire_equipment()
                self.reset_baseline = False
                if self._pulse_active:
                    if snapshot["online"]:
                        self._record_pulse_events(snapshot, old, health, warning)
                    return
                self.last_known_zone = known_zone(snapshot) if snapshot["online"] and snapshot["map"] > 0 else None
                if snapshot["online"] and not resume_bulk:
                    self._event("connected", "已连接角色", f"{snapshot['name']} · {snapshot['level']} 级 · {snapshot['zone']}", snapshot)
                return
            if self._pulse_active:
                if snapshot["online"]:
                    self._record_pulse_events(snapshot, old, health, warning)
                elif old["online"]:
                    self._clear_equipment(preserve_loadout=True)
                    self.reset_baseline = True
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
            self._record_zone(snapshot)
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
            self.life_at = None
            self.error = message
            if self._status() == "stale":
                self._clear_weapon_skills()
                self.reset_baseline = True
                self.equipment_pending.clear()
                self.comparison_pending.clear()
                if not self._pulse_active:
                    self.loadout_pending.clear()
                    self.inventory_pending.clear()
            if self._bulk_recovery is None and not self._low_frequency:
                self.quests_pending.clear()

    def capture_inventory_error(self, message: str) -> None:
        with self.lock:
            self.inventory_error = message

    def capture_quests_error(self, message: str) -> None:
        with self.lock:
            self.quests_error = message

    def capture_talents_error(self, message: str) -> None:
        with self.lock:
            self.talents_error = message

    def capture_weapon_skills_error(self, message: str) -> None:
        with self.lock:
            # Keep a valid complete observation until its TTL. A bad newer part
            # cannot replace it or invalidate the independent character heartbeat.
            self.weapon_skills_error = message

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
                self.life_at = None
                self.capture_revision += 1
                self._clear_equipment(preserve_loadout=self._pulse_active)
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
                self.life_at = None
                self.capture_revision += 1
                self._clear_equipment()
                self.demo = enabled
                self.snapshot = None
                self._profile_source = None
                self._profile_observed_at = None
                self._pulse_active = False
                self._reset_archive()
                self._needs_profile = False
                self._low_health_id = 0
                self._level_gate_id = 0
                self._loot_max = 0
                self._loot_seen.clear()
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
