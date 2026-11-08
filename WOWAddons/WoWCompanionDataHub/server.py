"""Anonymous installation and reported-token API. Production entry: server:create_app()."""

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from http.cookies import CookieError, SimpleCookie
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from store import COUNTERS, Conflict, Store, Unauthorized

MAX_SAFE = 9007199254740991
MAX_BODY = 32768
VERSION = "1.0.0"
PRE_RELEASE_ID = r"(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)"
SEMVER = re.compile(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)"
                    + rf"(?:-{PRE_RELEASE_ID}(?:\.{PRE_RELEASE_ID})*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?")
STATIC = {"/": ("index.html", "text/html; charset=utf-8"), "/index.html": ("index.html", "text/html; charset=utf-8"),
          "/dashboard.js": ("dashboard.js", "text/javascript; charset=utf-8"), "/dashboard.css": ("dashboard.css", "text/css; charset=utf-8")}


class RequestError(Exception):
    def __init__(self, status, code):
        self.status = status
        self.code = code


@dataclass(frozen=True)
class Config:
    database: Path
    admin_key: str
    allowed_hosts: tuple = ("localhost", "127.0.0.1", "[::1]")
    public_origin: str = ""
    secure_cookie: bool = False
    web_root: Path = Path(__file__).parent / "web"

    def __post_init__(self):
        if len(self.admin_key.encode("utf-8")) < 32 or self.admin_key.startswith("CHANGE_"):
            raise ValueError("ADMIN_KEY must contain at least 32 bytes")
        if not self.allowed_hosts:
            raise ValueError("Configure allowed hosts")
        if self.public_origin:
            parsed = urlsplit(self.public_origin)
            if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
                raise ValueError("PUBLIC_ORIGIN must be an HTTPS origin without a path")

    @classmethod
    def from_environment(cls):
        key_file = os.getenv("ADMIN_KEY_FILE", "")
        key = Path(key_file).read_text(encoding="utf-8").strip() if key_file else os.getenv("ADMIN_KEY", "")
        return cls(Path(os.getenv("DATAHUB_DATABASE", str(Path(__file__).parent / "data" / "statistics.sqlite"))), key,
                   tuple(value.strip().lower() for value in os.getenv("DATAHUB_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]").split(",") if value.strip()),
                   os.getenv("DATAHUB_PUBLIC_ORIGIN", "").rstrip("/"), os.getenv("DATAHUB_COOKIE_SECURE", "0") == "1")


def exact(value, fields):
    if not isinstance(value, dict) or set(value) != set(fields):
        raise RequestError(400, "invalid-fields")


def installation_id(value):
    try:
        parsed = uuid.UUID(value) if isinstance(value, str) else None
        if parsed is None or parsed.version != 4 or str(parsed) != value:
            raise ValueError()
    except ValueError:
        raise RequestError(400, "invalid-installation-id") from None
    return value


def installation_secret(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", value):
        raise RequestError(400, "invalid-installation-secret")
    decoded = base64.urlsafe_b64decode(value + "=")
    if len(decoded) != 32 or base64.urlsafe_b64encode(decoded).decode().rstrip("=") != value:
        raise RequestError(400, "invalid-installation-secret")
    return value


def counter(value, positive=False):
    if type(value) is not int or value < int(positive) or value > MAX_SAFE:
        raise RequestError(400, "invalid-counter")
    return value


def validate_counters(value):
    exact(value, COUNTERS)
    for amount in value.values():
        counter(amount)
    if value["requests"] != value["requestsWithUsage"] + value["requestsWithoutUsage"]:
        raise RequestError(400, "invalid-request-coverage")
    coverage = [value[key] for key in ("inputReportedRequests", "outputReportedRequests", "totalReportedRequests")]
    if any(amount > value["requestsWithUsage"] for amount in coverage) or sum(coverage) < value["requestsWithUsage"]:
        raise RequestError(400, "invalid-token-coverage")
    for count, tokens in zip(coverage, ("inputTokens", "outputTokens", "totalTokens")):
        if not count and value[tokens]:
            raise RequestError(400, "tokens-without-coverage")
    return value


class RateLimit:
    """IP addresses exist only in bounded process memory. They are not installation identities."""
    def __init__(self):
        self.entries = OrderedDict()
        self.lock = threading.Lock()

    def allow(self, address, category, maximum):
        now = time.monotonic()
        key = (address, category)
        with self.lock:
            window, count = self.entries.pop(key, (now, 0))
            if now - window >= 60:
                window, count = now, 0
            accepted = count < maximum
            self.entries[key] = (window, count + int(accepted))
            while len(self.entries) > 4096:
                self.entries.popitem(last=False)
            return accepted


class Application:
    def __init__(self, config, clock=time.time):
        self.config = config
        self.clock = clock
        self.store = Store(config.database, clock)
        self.limits = RateLimit()
        self.sessions = OrderedDict()
        self.session_lock = threading.Lock()

    def authorize_host(self, environ):
        host = environ.get("HTTP_HOST", "")
        if len(host) > 256 or any(character in host for character in "\r\n/\\@#?"):
            raise RequestError(403, "host-not-allowed")
        try:
            parsed = urlsplit("//" + host)
            hostname = parsed.hostname
            _ = parsed.port
        except ValueError:
            raise RequestError(403, "host-not-allowed") from None
        bracketed = f"[{hostname}]" if hostname and ":" in hostname else hostname
        if host.lower() not in self.config.allowed_hosts and bracketed not in self.config.allowed_hosts:
            raise RequestError(403, "host-not-allowed")
        origin = environ.get("HTTP_ORIGIN")
        expected = self.config.public_origin or environ.get("wsgi.url_scheme", "http") + "://" + host
        if origin is not None and origin != expected:
            raise RequestError(403, "origin-not-allowed")

    def read_json(self, environ):
        if environ.get("CONTENT_TYPE", "").split(";", 1)[0].strip().lower() != "application/json":
            raise RequestError(415, "json-required")
        if environ.get("HTTP_TRANSFER_ENCODING") or environ.get("HTTP_CONTENT_ENCODING") or environ.get("CONTENT_ENCODING"):
            raise RequestError(400, "encoded-body-not-supported")
        length = environ.get("CONTENT_LENGTH", "")
        if not re.fullmatch(r"[0-9]{1,10}", length):
            raise RequestError(411, "content-length-required")
        length = int(length)
        if length > MAX_BODY:
            raise RequestError(413, "body-too-large")
        body = environ["wsgi.input"].read(length)
        if len(body) != length:
            raise RequestError(400, "incomplete-body")
        def pairs(values):
            result = {}
            for key, value in values:
                if key in result:
                    raise ValueError("duplicate field")
                result[key] = value
            return result
        try:
            return json.loads(body.decode("utf-8"), object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("invalid constant")))
        except (UnicodeError, ValueError, RecursionError):
            raise RequestError(400, "invalid-json") from None

    def client_auth(self, environ):
        authorization = environ.get("HTTP_AUTHORIZATION", "")
        if not authorization.startswith("Bearer ") or len(authorization) > 256:
            raise RequestError(401, "unauthorized")
        parts = authorization[7:].split(".")
        if len(parts) != 2:
            raise RequestError(401, "unauthorized")
        try:
            return installation_id(parts[0]), installation_secret(parts[1])
        except RequestError:
            raise RequestError(401, "unauthorized") from None

    def admin_auth(self, environ):
        authorization = environ.get("HTTP_AUTHORIZATION", "")
        if authorization.startswith("Bearer ") and hmac.compare_digest(authorization[7:].encode(), self.config.admin_key.encode()):
            return
        cookie = SimpleCookie()
        try:
            cookie.load(environ.get("HTTP_COOKIE", ""))
            token = cookie["datahub_session"].value
        except (KeyError, ValueError, CookieError):
            raise RequestError(401, "admin-auth-required") from None
        digest = hashlib.sha256(token.encode()).hexdigest()
        with self.session_lock:
            expires = self.sessions.get(digest, 0)
            if expires <= self.clock():
                self.sessions.pop(digest, None)
                raise RequestError(401, "admin-auth-required")

    def cookie(self, token, age=3600):
        secure = self.config.secure_cookie or bool(self.config.public_origin)
        return f"datahub_session={token}; Path=/api/v1/admin; HttpOnly; SameSite=Strict; Max-Age={age}" + ("; Secure" if secure else "")

    def route(self, environ):
        self.authorize_host(environ)
        path = environ.get("PATH_INFO", "")
        method = environ.get("REQUEST_METHOD", "GET")
        category, maximum = ("session", 10) if path == "/api/v1/admin/session" else ("register", 600) if path == "/api/v1/installations" else ("requests", 6000)
        if not self.limits.allow(environ.get("REMOTE_ADDR", ""), category, maximum):
            raise RequestError(429, "rate-limited")
        if method == "GET" and path == "/health":
            return 200, {"ok": True, "service": "wow-companion-data-hub", "version": VERSION}, []
        if method == "GET" and path in STATIC:
            name, mime = STATIC[path]
            try:
                return 200, (self.config.web_root / name).read_bytes(), [("Content-Type", mime)]
            except FileNotFoundError:
                raise RequestError(404, "not-found") from None
        if method == "POST" and path == "/api/v1/installations":
            body = self.read_json(environ)
            exact(body, ("protocol", "installationId", "installationSecret", "clientVersion", "platform"))
            if type(body["protocol"]) is not int or body["protocol"] != 1 or body["platform"] not in ("win32", "darwin", "linux"):
                raise RequestError(400, "invalid-protocol")
            if not isinstance(body["clientVersion"], str) or len(body["clientVersion"]) > 64 or not SEMVER.fullmatch(body["clientVersion"]):
                raise RequestError(400, "invalid-version")
            identity = installation_id(body["installationId"])
            created, server_time = self.store.register(identity, installation_secret(body["installationSecret"]), body["clientVersion"], body["platform"])
            return 201 if created else 200, {"ok": True, "status": "registered" if created else "existing", "installationId": identity, "serverTime": server_time}, []
        if method == "POST" and path == "/api/v1/usage":
            identity, secret = self.client_auth(environ)
            body = self.read_json(environ)
            exact(body, ("protocol", "sequence", "counters"))
            if type(body["protocol"]) is not int or body["protocol"] != 1:
                raise RequestError(400, "invalid-protocol")
            result = self.store.observe(identity, secret, counter(body["sequence"], True), validate_counters(body["counters"]))
            return 200, result, []
        if method == "POST" and path == "/api/v1/admin/session":
            body = self.read_json(environ)
            exact(body, ("key",))
            if not isinstance(body["key"], str) or not hmac.compare_digest(body["key"].encode(), self.config.admin_key.encode()):
                raise RequestError(401, "admin-auth-required")
            token = secrets.token_urlsafe(32)
            with self.session_lock:
                self.sessions[hashlib.sha256(token.encode()).hexdigest()] = self.clock() + 3600
                while len(self.sessions) > 1024:
                    self.sessions.popitem(last=False)
            return 201, {"ok": True, "expiresIn": 3600}, [("Set-Cookie", self.cookie(token))]
        if method == "POST" and path == "/api/v1/admin/logout":
            self.admin_auth(environ)
            cookie = SimpleCookie()
            cookie.load(environ.get("HTTP_COOKIE", ""))
            if "datahub_session" in cookie:
                with self.session_lock:
                    self.sessions.pop(hashlib.sha256(cookie["datahub_session"].value.encode()).hexdigest(), None)
            return 200, {"ok": True}, [("Set-Cookie", self.cookie("", 0))]
        if method == "GET" and path == "/api/v1/admin/stats":
            self.admin_auth(environ)
            query = parse_qs(environ.get("QUERY_STRING", ""), keep_blank_values=True)
            if set(query) - {"days"} or len(query.get("days", ["7"])) != 1:
                raise RequestError(400, "invalid-days")
            day_string = query.get("days", ["7"])[0]
            if not re.fullmatch(r"[0-9]{1,2}", day_string) or not 1 <= int(day_string) <= 90:
                raise RequestError(400, "invalid-days")
            return 200, self.store.stats(int(day_string)), []
        raise RequestError(404, "not-found")

    def __call__(self, environ, start_response):
        try:
            # Gunicorn exposes its connection socket. Bound body reads independently of worker liveness.
            connection = environ.get("gunicorn.socket")
            if connection is not None:
                connection.settimeout(30)
            status, body, headers = self.route(environ)
        except RequestError as error:
            status, body, headers = error.status, {"ok": False, "error": error.code}, []
        except Unauthorized:
            status, body, headers = 401, {"ok": False, "error": "unauthorized"}, []
        except Conflict as error:
            status, body, headers = 409, {"ok": False, "error": str(error)}, []
        except TimeoutError:
            status, body, headers = 408, {"ok": False, "error": "request-timeout"}, []
        except Exception:
            # Never send a traceback, request body, key, database path or authorization header to a client or access log.
            status, body, headers = 500, {"ok": False, "error": "server-error"}, []
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            headers.append(("Content-Type", "application/json; charset=utf-8"))
        headers.extend([("Content-Length", str(len(body))), ("Cache-Control", "no-store"), ("X-Content-Type-Options", "nosniff"),
                        ("Referrer-Policy", "no-referrer"), ("Cross-Origin-Resource-Policy", "same-origin"),
                        ("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'")])
        from http import HTTPStatus
        start_response(f"{status} {HTTPStatus(status).phrase}", headers)
        return [body]


def create_app(config=None, clock=time.time):
    return Application(config or Config.from_environment(), clock)


if __name__ == "__main__":
    import argparse
    from wsgiref.simple_server import WSGIRequestHandler, make_server
    parser = argparse.ArgumentParser(description="Loopback development server. Use Gunicorn behind HTTPS in production.")
    parser.add_argument("--dev", action="store_true", required=True)
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    class QuietHandler(WSGIRequestHandler):
        def log_message(self, *_args):
            pass
    with make_server("127.0.0.1", args.port, create_app(), handler_class=QuietHandler) as development_server:
        print(f"Development dashboard: http://127.0.0.1:{development_server.server_port}", flush=True)
        development_server.serve_forever()
