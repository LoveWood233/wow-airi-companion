"""Validated snapshots become bounded, deduplicated companion events."""

from __future__ import annotations

import copy
import threading
import time
import uuid
from collections import deque
from datetime import datetime, timezone

DEFAULT_CONFIG = {"x": 8, "y": 8, "cellSize": 2, "pollMs": 500, "paused": False}


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
            low, high = {"x": (-32768, 32767), "y": (-32768, 32767), "cellSize": (1, 12), "pollMs": (250, 5000)}[key]
            if type(value) is not int or not low <= value <= high:
                raise ValueError(f"{key} 必须在 {low}–{high} 范围内")
        result[key] = value
    return result


class CompanionState:
    def __init__(self, config: dict | None = None, clock=time.monotonic):
        self.lock = threading.RLock()
        self.clock = clock
        self.instance_id = str(uuid.uuid4())
        self.config = validate_config(config or {})
        self.snapshot: dict | None = None
        self.events = deque(maxlen=200)
        self.event_id = 0
        self.fresh_at: float | None = None
        self.last_seen: str | None = None
        self.last_tick = None
        self.error = "等待插件的 WCP1 遥测网格"
        self.demo = False
        self.reset_baseline = True
        self.last_known_zone: tuple[int, str] | None = None
        self.frame_bmp: bytes | None = None

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
            age = round(max(0, self.clock() - self.fresh_at), 2) if self.fresh_at is not None else None
            status = self._status()
            return {"instanceId": self.instance_id, "status": status, "source": "demo" if self.demo else "screen", "snapshot": copy.deepcopy(self.snapshot),
                    "lastSeen": self.last_seen, "ageSeconds": age, "eventCursor": self.event_id,
                    "events": copy.deepcopy([e for e in self.events if after is None or e["id"] > after]),
                    "config": dict(self.config), "error": self.error if status != "live" else None,
                    "staleAfterSeconds": 5, "protocol": "WCP1"}

    def _event(self, kind: str, title: str, detail: str, snapshot: dict) -> None:
        self.event_id += 1
        self.events.append({"id": self.event_id, "type": kind, "timestamp": utc_now(), "title": title,
                            "detail": detail, "snapshot": copy.deepcopy(snapshot), "demo": self.demo})

    def ingest(self, snapshot: dict) -> None:
        with self.lock:
            old = self.snapshot
            identity_changed = old is None or (old["guid"], old["session"]) != (snapshot["guid"], snapshot["session"])
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
                return
            self.snapshot = copy.deepcopy(snapshot)
            if self.reset_baseline or identity_changed or was_stale:
                self.reset_baseline = False
                self.last_known_zone = known_zone(snapshot) if snapshot["online"] else None
                if snapshot["online"]:
                    self._event("connected", "已连接角色", f"{snapshot['name']} · {snapshot['level']} 级 · {snapshot['zone']}", snapshot)
                return
            if old is None or snapshot["seq"] == old["seq"]:
                return
            if not snapshot["online"]:
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
                    self._event("death", "角色倒下", "角色已死亡，可以温和安慰，不催促操作", snapshot)
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

    def update_config(self, patch: dict) -> dict:
        with self.lock:
            result = validate_config(patch, self.config)
            changed = result != self.config
            self.config = result
            if changed:
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
                self.ingest({"v": 1, "session": "demo-session", "seq": 1, "tick": 1, "guid": "DEMO-PLAYER",
                             "name": "演示冒险者", "realm": "演示服务器", "level": 29, "class": "MAGE", "spec": 64,
                             "map": 37, "zone": "艾尔文森林（演示）", "combat": False, "dead": False, "online": True})
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
