"""WCP1 black/white telemetry protocol. Pure Python, no Windows dependencies."""

from __future__ import annotations

import binascii
import json
import re
import struct

COLS = ROWS = 64
FRAME_BYTES = 512
MAX_PAYLOAD = 504
MAX_SAFE_INTEGER = 9007199254740991


class FrameError(ValueError):
    pass


def validate_snapshot(value: object) -> dict:
    if not isinstance(value, dict):
        raise FrameError("快照必须是 JSON 对象")
    string_limits = {"session": 64, "guid": 96, "name": 64, "realm": 96, "class": 32, "zone": 192}
    result = {}
    for key, maximum in string_limits.items():
        item = value.get(key)
        if not isinstance(item, str) or len(item.encode("utf-8")) > maximum or any(ord(c) < 32 for c in item):
            raise FrameError(f"字段 {key} 不合法")
        result[key] = item
    if not result["session"] or not result["guid"] or not result["name"]:
        raise FrameError("缺少角色或会话标识")
    if not re.fullmatch(r"[A-Z_]{1,32}", result["class"]):
        raise FrameError("职业标识不合法")
    ranges = {"v": (2, 2), "seq": (0, 2147483647), "tick": (0, 2147483647),
              "level": (1, 255), "spec": (0, 65535), "map": (0, 2147483647)}
    for key, (minimum, maximum) in ranges.items():
        item = value.get(key)
        if type(item) is not int or not minimum <= item <= maximum:
            raise FrameError(f"字段 {key} 超出范围")
        result[key] = item
    for key in ("account", "moneyEpoch"):
        item = value.get(key)
        if not isinstance(item, str) or re.fullmatch(r"[A-Za-z0-9_-]{1,40}", item) is None:
            raise FrameError(f"字段 {key} 不合法")
        result[key] = item
    for key in ("copper", "earned", "spent"):
        item = value.get(key)
        if key == "copper" and key in value and item is None:
            result[key] = None
            continue
        if type(item) is not int or not 0 <= item <= MAX_SAFE_INTEGER:
            raise FrameError(f"字段 {key} 必须是安全的非负整数铜币数")
        result[key] = item
    for key in ("combat", "dead", "online"):
        item = value.get(key)
        if type(item) is not bool:
            raise FrameError(f"字段 {key} 必须是布尔值")
        result[key] = item
    return result


def encode_frame(snapshot: dict) -> bytes:
    """Used for fixtures and diagnostics; the game addon implements the same codec."""
    validate_snapshot(snapshot)
    payload = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(payload) > MAX_PAYLOAD:
        raise FrameError("遥测数据超过 504 字节")
    frame = b"WCP1" + struct.pack("<HH", len(payload), binascii.crc_hqx(payload, 0xFFFF)) + payload
    return frame.ljust(FRAME_BYTES, b"\0")


def decode_frame(frame: bytes) -> dict:
    if len(frame) != FRAME_BYTES or frame[:4] != b"WCP1":
        raise FrameError("未找到 WCP1 网格，请检查坐标、大小和游戏画面")
    length, expected_crc = struct.unpack_from("<HH", frame, 4)
    if not 1 <= length <= MAX_PAYLOAD:
        raise FrameError("遥测长度不合法")
    payload = frame[8:8 + length]
    if binascii.crc_hqx(payload, 0xFFFF) != expected_crc:
        raise FrameError("CRC 校验失败，等待下一完整帧")
    try:
        value = json.loads(payload.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise FrameError("遥测 JSON 或 UTF-8 不合法") from exc
    return validate_snapshot(value)


def decode_pixels(bgra: bytes, width: int, height: int, cell_size: int) -> dict:
    """Decode a top-down 32-bit BGRA crop, sampling cell centers."""
    if width != COLS * cell_size or height != ROWS * cell_size or len(bgra) != width * height * 4:
        raise FrameError("截图尺寸与网格配置不匹配")
    frame = bytearray(FRAME_BYTES)
    offset = cell_size // 2
    for i in range(COLS * ROWS):
        x, y = (i % COLS) * cell_size + offset, (i // COLS) * cell_size + offset
        position = (y * width + x) * 4
        b, g, r = bgra[position:position + 3]
        intensity = (r + g + b) // 3
        if 96 < intensity < 160:
            raise FrameError("网格像素模糊或被遮挡，请检查缩放、位置和 HDR")
        if intensity >= 160:
            frame[i // 8] |= 1 << (7 - i % 8)
    return decode_frame(bytes(frame))


def pixels_for_frame(frame: bytes, cell_size: int = 2) -> bytes:
    """Synthetic image for protocol tests. Never used as live game data."""
    rows = []
    for y in range(ROWS):
        row = bytearray()
        for x in range(COLS):
            i = y * COLS + x
            v = 255 if frame[i // 8] & (1 << (7 - i % 8)) else 0
            row.extend(bytes((v, v, v, 255)) * cell_size)
        rows.extend([bytes(row)] * cell_size)
    return b"".join(rows)
