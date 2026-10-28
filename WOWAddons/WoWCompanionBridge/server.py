"""Local-only WoW telemetry bridge. Run: python server.py"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import BinaryIO
from urllib.parse import parse_qs, urlsplit

from capture import ScreenCapture, to_bmp
from geometry import AdaptiveCaptureReader
from protocol import GAME_PROTOCOLS, EquipmentComparisonError, EquipmentOfferError, EquipmentSwapError, EquipmentLoadoutError, FrameError
from state import CompanionState, validate_config

ROOT = Path(__file__).resolve().parent
VERSION = "2.12.0"


def allowed_origin(origin: str | None) -> bool:
    if origin is None:
        return True
    if origin.rstrip("/") == "airi://local":
        return True
    try:
        parts = urlsplit(origin)
        _ = parts.port
        return (parts.scheme in ("http", "https") and parts.hostname in ("localhost", "127.0.0.1", "::1")
                and parts.username is None and parts.password is None and parts.path in ("", "/")
                and not parts.query and not parts.fragment)
    except ValueError:
        return False


class BridgeServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, state: CompanionState, config_path: Path | None = None):
        super().__init__(address, Handler)
        self.state = state
        self.config_path = config_path


class Handler(BaseHTTPRequestHandler):
    server_version = f"WoWCompanionBridge/{VERSION}"

    def _permitted(self) -> bool:
        try:
            host = urlsplit("http://" + self.headers.get("Host", "")).hostname
        except ValueError:
            host = None
        if host not in ("127.0.0.1", "localhost", "::1"):
            self._json(403, {"error": "仅接受本机 Host"})
            return False
        origin = self.headers.get("Origin")
        if not allowed_origin(origin) or (not origin and self.headers.get("Sec-Fetch-Site") == "cross-site"):
            self._json(403, {"error": "不允许此网页来源访问本机桥接"})
            return False
        return True

    def _send(self, code: int, content: bytes, content_type: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        origin = self.headers.get("Origin")
        if origin and allowed_origin(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        if content_type.startswith("text/html"):
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
        if self.command == "OPTIONS":
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        if content:
            try:
                self.wfile.write(content)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def _json(self, code: int, payload: dict) -> None:
        self._send(code, json.dumps(payload, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def do_OPTIONS(self):
        if self._permitted():
            self._send(204, b"", "text/plain")

    def do_GET(self):
        if not self._permitted():
            return
        parsed = urlsplit(self.path)
        path = parsed.path
        if path == "/":
            self._send(200, (ROOT / "index.html").read_bytes(), "text/html; charset=utf-8")
        elif path in ("/health", "/api/health"):
            self._json(200, {"ok": True, "service": "wow-companion-bridge", "version": VERSION,
                             "protocol": self.server.state.protocol, "game": self.server.state.game,
                             "instanceId": self.server.state.instance_id})
        elif path == "/api/status":
            self._json(200, self.server.state.view())
        elif path == "/api/events":
            try:
                after = int(parse_qs(parsed.query).get("after", ["0"])[0])
                if after < 0:
                    raise ValueError()
            except (ValueError, IndexError):
                self._json(400, {"error": "after 必须是非负整数"})
                return
            view = self.server.state.view(after)
            self._json(200, {"instanceId": view["instanceId"], "events": view["events"], "cursor": view["eventCursor"], "status": view["status"]})
        elif path == "/api/frame.bmp":
            with self.server.state.lock:
                frame = self.server.state.frame_bmp
            if frame is None:
                self._json(404, {"error": "尚无真实截图；演示模式不生成伪造截图"})
            else:
                self._send(200, frame, "image/bmp")
        else:
            self._json(404, {"error": "接口不存在"})

    def do_POST(self):
        if not self._permitted():
            return
        if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
            self._json(415, {"error": "写入请求只接受 application/json"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 1 <= length <= 4096:
                self._json(413, {"error": "JSON 请求须为 1–4096 字节"})
                return
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(data, dict):
                raise ValueError("请求必须是 JSON 对象")
            path = urlsplit(self.path).path
            if path == "/api/config":
                # Validate and write first: a failed persistence operation cannot claim success.
                with self.server.state.lock:
                    config = validate_config(data, self.server.state.config)
                    if self.server.config_path is not None:
                        target = self.server.config_path
                        temporary = target.with_suffix(target.suffix + ".tmp")
                        temporary.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
                        os.replace(temporary, target)
                    self.server.state.update_config(config)
            elif path == "/api/demo":
                if set(data) - {"enabled", "action"}:
                    raise ValueError("演示接口只接受 enabled、action")
                self.server.state.set_demo(data.get("enabled"), data.get("action"))
            else:
                self._json(404, {"error": "接口不存在"})
                return
        except (ValueError, UnicodeDecodeError) as exc:
            self._json(400, {"error": str(exc)})
            return
        except OSError:
            self._json(500, {"error": "无法保存本机配置，请检查目录写权限"})
            return
        self._json(200, self.server.state.view())

    def log_message(self, format, *args):
        # Avoid writing character names, snapshots, request bodies or constant poll noise.
        if len(args) < 2 or str(args[1]) not in ("200", "204", "304"):
            super().log_message(format, *args)


def capture_loop(state: CompanionState, stop: threading.Event) -> None:
    reader = AdaptiveCaptureReader()
    try:
        capture = ScreenCapture()
    except (OSError, RuntimeError) as exc:
        capture = None
        state.capture_error(str(exc))
    while not stop.is_set():
        with state.lock:
            config = dict(state.config)
            demo = state.demo
        if not config["paused"] and not demo:
            if capture is None:
                state.capture_error("无法创建 Windows 画面采集器；请检查运行环境")
            else:
                try:
                    try:
                        snapshot = reader.read(capture, config, state.protocol)
                    finally:
                        if reader.image is not None:
                            pixels = reader.image.pixels
                            width, height = reader.image.width, reader.image.height
                    with state.lock:
                        # Config/demo may have changed while BitBlt was running.
                        if state.config == config and not state.demo:
                            state.frame_bmp = to_bmp(pixels, width, height)
                            state.ingest(snapshot)
                except EquipmentLoadoutError as exc:
                    with state.lock:
                        if state.config == config and not state.demo:
                            state.frame_bmp = to_bmp(pixels, width, height)
                            state.capture_loadout_error(str(exc))
                except EquipmentComparisonError as exc:
                    with state.lock:
                        if state.config == config and not state.demo:
                            state.frame_bmp = to_bmp(pixels, width, height)
                            state.capture_comparison_error(str(exc))
                except EquipmentOfferError as exc:
                    with state.lock:
                        if state.config == config and not state.demo:
                            state.frame_bmp = to_bmp(pixels, width, height)
                            state.capture_offer_error(str(exc))
                except EquipmentSwapError as exc:
                    with state.lock:
                        if state.config == config and not state.demo:
                            state.frame_bmp = to_bmp(pixels, width, height)
                            state.capture_swap_error(str(exc))
                except FrameError as exc:
                    with state.lock:
                        if state.config == config and not state.demo:
                            state.frame_bmp = to_bmp(pixels, width, height)
                            state.capture_error(str(exc))
                except (OSError, ValueError) as exc:
                    state.capture_error(f"屏幕采集失败：{exc}")
        stop.wait(config["pollMs"] / 1000)


def watch_parent_input(server: BridgeServer, stream: BinaryIO) -> None:
    """A managed child exits when AIRI closes its pipe, including after a crash."""
    while stream.read(1):
        pass
    server.shutdown()


def main():
    parser = argparse.ArgumentParser(description="WoW 正式服 / 无限服本机陪伴桥接")
    parser.add_argument("--game", choices=tuple(GAME_PROTOCOLS), default="retail")
    parser.add_argument("--port", type=int)
    parser.add_argument("--config", type=Path)
    parser.add_argument("--demo", action="store_true", help="明确启用演示数据，默认不启用")
    parser.add_argument("--managed-stdin", action="store_true", help="随父进程的 stdin 管道关闭而退出")
    args = parser.parse_args()
    if args.port is None:
        args.port = 18766 if args.game == "forever" else 18765
    if args.config is None:
        args.config = ROOT / ("bridge-config-forever.json" if args.game == "forever" else "bridge-config.json")
    if not 1 <= args.port <= 65535:
        parser.error("端口必须在 1–65535 范围内")
    try:
        config = json.loads(args.config.read_text(encoding="utf-8-sig")) if args.config.exists() else {}
        state = CompanionState(config, game=args.game)
    except (OSError, ValueError) as exc:
        parser.error(f"无法读取配置：{exc}")
    if args.demo:
        state.set_demo(True)
    stop = threading.Event()
    try:
        server = BridgeServer(("127.0.0.1", args.port), state, args.config)
    except OSError as exc:
        parser.error(f"无法监听 127.0.0.1:{args.port}：{exc}")
    worker = threading.Thread(target=capture_loop, args=(state, stop), daemon=True, name="wow-screen-capture")
    worker.start()
    if args.managed_stdin:
        threading.Thread(target=watch_parent_input, args=(server, sys.stdin.buffer), daemon=True,
                         name="airi-parent-watch").start()
    print(f"WoW Companion Bridge ({args.game}): http://127.0.0.1:{args.port}/", flush=True)
    print("Demo enabled: " + str(args.demo), flush=True)
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        server.server_close()
        worker.join(timeout=3)


if __name__ == "__main__":
    main()
