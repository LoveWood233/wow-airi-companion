import concurrent.futures
import io
import json
import os
import secrets
import sqlite3
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import uuid
from unittest.mock import Mock, patch
from contextlib import closing
from pathlib import Path
from socketserver import ThreadingMixIn
from wsgiref.simple_server import WSGIRequestHandler, WSGIServer, make_server

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Application, Config, MAX_SAFE, RateLimit
from setup import initialize
from store import COUNTERS, Store


class ThreadedTestServer(ThreadingMixIn, WSGIServer):
    daemon_threads = True


class QuietHandler(WSGIRequestHandler):
    def log_message(self, *_args):
        pass


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.web = self.root / "web"
        self.web.mkdir()
        (self.web / "index.html").write_text("<!doctype html><title>统计测试</title>", encoding="utf-8")
        (self.web / "dashboard.js").write_text("console.log('test');", encoding="utf-8")
        (self.web / "dashboard.css").write_text("body{color:black}", encoding="utf-8")
        self.now = 1793750400.0
        self.key = "test-administrator-" + "x" * 48
        self.database = self.root / "statistics.sqlite"
        self.app = Application(Config(self.database, self.key, web_root=self.web), clock=lambda: self.now)
        self.server = make_server("127.0.0.1", 0, self.app, server_class=ThreadedTestServer, handler_class=QuietHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.close_server)
        self.base = f"http://127.0.0.1:{self.server.server_port}"
        self.identity = str(uuid.uuid4())
        self.secret = secrets.token_urlsafe(32)

    def close_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(3)

    def request(self, path, body=None, headers=None, method=None, raw=None):
        headers = {**(headers or {})}
        if body is not None:
            raw = json.dumps(body).encode()
            headers.setdefault("Content-Type", "application/json")
        request = urllib.request.Request(self.base + path, data=raw, headers=headers, method=method)
        try:
            response = urllib.request.urlopen(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            content = response.read()
            payload = json.loads(content) if response.headers.get("Content-Type", "").startswith("application/json") else content
            return response.status, payload, response.headers

    def register(self, **updates):
        return self.request("/api/v1/installations", {"protocol": 1, "installationId": self.identity, "installationSecret": self.secret, "clientVersion": "2.26.0", "platform": "win32", **updates})

    def counters(self, requests=1, input_tokens=20, output_tokens=10):
        return {"requests": requests, "requestsWithUsage": requests, "requestsWithoutUsage": 0,
                "inputTokens": input_tokens, "outputTokens": output_tokens, "totalTokens": input_tokens + output_tokens,
                "inputReportedRequests": requests, "outputReportedRequests": requests, "totalReportedRequests": requests}

    def usage(self, sequence=1, counters=None, secret=None):
        return self.request("/api/v1/usage", {"protocol": 1, "sequence": sequence, "counters": counters if counters is not None else self.counters()},
                            {"Authorization": f"Bearer {self.identity}.{secret or self.secret}"})

    def stats(self, path="/api/v1/admin/stats?days=7", cookie=None):
        headers = {"Cookie": cookie} if cookie else {"Authorization": "Bearer " + self.key}
        return self.request(path, headers=headers)

    def test_health_static_and_no_arbitrary_files(self):
        self.assertEqual(self.request("/health")[1]["ok"], True)
        self.assertEqual(self.request("/")[0], 200)
        self.assertEqual(self.request("/dashboard.js")[0], 200)
        self.assertEqual(self.request("/dashboard.css")[0], 200)
        for path in ("/server.py", "/.env", "/secrets/admin-key.txt", "/../store.py", "/%2e%2e/store.py"):
            self.assertEqual(self.request(path)[0], 404)

    def test_install_registration_is_idempotent_and_does_not_refresh_activity(self):
        self.assertEqual(self.register()[0], 201)
        self.now += 301
        self.assertEqual(self.register()[0], 200)
        result = self.stats()[1]
        self.assertEqual(result["totalInstallations"], 1)
        self.assertEqual(result["activeInstallations5m"], 0)
        self.assertEqual(result["activeInstallations24h"], 1)
        self.assertEqual(result["versions"], [{"version": "2.26.0", "installations": 1}])

    def test_conflicting_install_secret_cannot_take_over(self):
        self.register()
        wrong = secrets.token_urlsafe(32)
        self.assertEqual(self.register(installationSecret=wrong)[0], 409)
        self.assertEqual(self.usage(secret=wrong)[0], 401)
        self.assertEqual(self.stats()[1]["totalInstallations"], 1)

    def test_usage_retry_and_old_sequence_never_double_count(self):
        self.register()
        self.assertEqual(self.usage()[1]["status"], "accepted")
        self.assertEqual(self.usage()[1]["status"], "duplicate")
        self.assertEqual(self.usage(3, self.counters(2, 30, 20))[1]["status"], "accepted")
        self.assertEqual(self.usage(2)[1]["status"], "stale")
        result = self.stats()[1]
        self.assertEqual(result["totals"], self.counters(2, 30, 20))
        self.assertEqual(sum(row["totalTokens"] for row in result["daily"]), 50)

    def test_conflict_rolls_back_both_checkpoint_and_daily_delta(self):
        self.register()
        self.usage()
        self.assertEqual(self.usage(1, self.counters(2, 40, 20))[0], 409)
        self.assertEqual(self.usage(2, self.counters(2, 1, 1))[0], 409)
        self.assertEqual(self.stats()[1]["totals"], self.counters())
        self.assertEqual(self.usage()[1]["status"], "duplicate")

    def test_heartbeat_without_new_usage_updates_activity(self):
        self.register()
        empty = {key: 0 for key in COUNTERS}
        self.now += 400
        self.assertEqual(self.usage(1, empty)[0], 200)
        self.assertEqual(self.stats()[1]["activeInstallations5m"], 1)
        self.assertEqual(self.stats()[1]["totals"]["totalTokens"], 0)

    def test_receive_day_and_unknown_usage_are_separate(self):
        self.register()
        self.usage()
        self.now += 86400
        next_counters = self.counters()
        next_counters["requests"] = 2
        next_counters["requestsWithoutUsage"] = 1
        self.usage(2, next_counters)
        daily = self.stats()[1]["daily"]
        self.assertEqual(daily[-2]["totalTokens"], 30)
        self.assertEqual(daily[-1]["totalTokens"], 0)
        self.assertEqual(daily[-1]["requestsWithoutUsage"], 1)

    def test_total_only_usage_and_provider_total_not_equal_to_input_plus_output(self):
        self.register()
        total_only = {key: 0 for key in COUNTERS}
        total_only.update(requests=1, requestsWithUsage=1, totalTokens=99, totalReportedRequests=1)
        self.assertEqual(self.usage(1, total_only)[0], 200)
        arbitrary_total = self.counters(2, 20, 10)
        arbitrary_total["totalTokens"] = 105
        self.assertEqual(self.usage(2, arbitrary_total)[0], 200)
        self.assertEqual(self.stats()[1]["totals"]["totalTokens"], 105)

    def test_authenticated_stats_do_not_return_identifiers_or_secrets(self):
        self.register()
        self.usage()
        self.assertEqual(self.request("/api/v1/admin/stats")[0], 401)
        result = self.stats()[1]
        encoded = json.dumps(result)
        self.assertNotIn(self.secret, encoded)
        self.assertNotIn(self.identity, encoded)
        self.assertNotIn(self.key, encoded)

    def test_session_cookie_expiry_logout_and_header_flags(self):
        status, _, headers = self.request("/api/v1/admin/session", {"key": self.key})
        self.assertEqual(status, 201)
        cookie = headers["Set-Cookie"]
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Strict", cookie)
        self.assertEqual(self.stats(cookie=cookie)[0], 200)
        self.assertEqual(self.request("/api/v1/admin/logout", headers={"Cookie": cookie}, method="POST")[0], 200)
        self.assertEqual(self.stats(cookie=cookie)[0], 401)
        _, _, headers = self.request("/api/v1/admin/session", {"key": self.key})
        self.now += 3601
        self.assertEqual(self.stats(cookie=headers["Set-Cookie"])[0], 401)

    def test_origin_host_csrf_and_cors(self):
        self.assertEqual(self.request("/health", headers={"Host": "evil.example"})[0], 403)
        self.assertEqual(self.request("/health", headers={"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.request("/api/v1/admin/session", {"key": self.key}, {"Origin": "https://evil.example"})[0], 403)
        status, _, headers = self.request("/api/v1/admin/session", {"key": self.key}, {"Origin": self.base})
        self.assertEqual(status, 201)
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
        self.assertEqual(self.request("/api/v1/usage", method="OPTIONS")[0], 404)

    def test_json_schema_body_limit_and_no_secret_echo(self):
        self.assertEqual(self.request("/api/v1/installations", raw=b"{}", method="POST")[0], 415)
        self.assertEqual(self.request("/api/v1/installations", raw=b"x" * 32769, headers={"Content-Type": "application/json"}, method="POST")[0], 413)
        for body in (b'{"protocol":1,"protocol":1}', b'{"x":NaN}', b'{invalid'):
            self.assertEqual(self.request("/api/v1/installations", raw=body, headers={"Content-Type": "application/json"}, method="POST")[0], 400)
        status, body, _ = self.register(chat="private text must not be stored")
        self.assertEqual(status, 400)
        self.assertNotIn("private text", json.dumps(body))

    def test_counter_validation(self):
        self.register()
        mutations = [dict(requests=True), dict(totalTokens=-1), dict(inputTokens=MAX_SAFE + 1), dict(requests=4),
                     dict(inputReportedRequests=2), dict(totalReportedRequests=0, outputReportedRequests=0, inputReportedRequests=0)]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                values = self.counters()
                values.update(mutation)
                self.assertEqual(self.usage(1, values)[0], 400)
        self.assertEqual(self.stats()[1]["totals"]["requests"], 0)

    def test_invalid_registration_identifiers_and_protocols(self):
        for changes in (dict(protocol=True), dict(installationId="person-name"), dict(installationSecret="short"), dict(clientVersion="dev"),
                        dict(clientVersion="1.0.0-01"), dict(clientVersion="1.0.0-alpha..1"), dict(clientVersion="1.0.0+.."), dict(platform="unknown")):
            with self.subTest(changes=changes):
                self.assertEqual(self.register(**changes)[0], 400)
        self.assertEqual(self.stats()[1]["totalInstallations"], 0)

    def test_days_boundaries(self):
        self.assertEqual(self.stats("/api/v1/admin/stats?days=1")[0], 200)
        self.assertEqual(self.stats("/api/v1/admin/stats?days=90")[0], 200)
        for query in ("days=0", "days=91", "days=1&days=2", "days=none", "path=/etc/passwd"):
            self.assertEqual(self.stats("/api/v1/admin/stats?" + query)[0], 400)

    def test_concurrent_duplicate_reports_commit_once(self):
        self.register()
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            responses = list(pool.map(lambda _: self.usage(), range(8)))
        self.assertTrue(all(response[0] == 200 for response in responses))
        self.assertEqual(sum(response[1]["status"] == "accepted" for response in responses), 1)
        self.assertEqual(self.stats()[1]["totals"]["totalTokens"], 30)

    def test_restart_backup_and_database_never_store_raw_secret(self):
        self.register()
        self.usage()
        restored = Store(self.database, lambda: self.now)
        self.assertEqual(restored.stats(7)["totals"]["totalTokens"], 30)
        backup = self.root / "backup.sqlite"
        restored.backup(backup)
        with closing(sqlite3.connect(backup)) as db:
            self.assertEqual(db.execute("PRAGMA quick_check").fetchone()[0], "ok")
            self.assertEqual(db.execute("SELECT count(*) FROM installations").fetchone()[0], 1)
        self.assertNotIn(self.secret.encode(), backup.read_bytes())
        self.assertNotIn(self.key.encode(), backup.read_bytes())


class UnitTests(unittest.TestCase):
    def test_secret_file_precedes_environment_and_missing_file_fails_closed(self):
        with tempfile.TemporaryDirectory() as root:
            key_file = Path(root) / "test-key.txt"
            key_file.write_text("from-file-" + "x" * 40, encoding="utf-8")
            with patch.dict(os.environ, {"ADMIN_KEY_FILE": str(key_file), "ADMIN_KEY": "from-env-" + "y" * 40}, clear=True):
                self.assertEqual(Config.from_environment().admin_key, key_file.read_text())
                key_file.unlink()
                with self.assertRaises(FileNotFoundError):
                    Config.from_environment()

    def test_wsgi_socket_timeout_returns_private_error(self):
        app = Application.__new__(Application)
        app.route = Mock(side_effect=TimeoutError("private body must not be echoed"))
        connection = Mock()
        response = []
        body = b"".join(app({"gunicorn.socket": connection}, lambda status, headers: response.append(status)))
        connection.settimeout.assert_called_once_with(30)
        self.assertEqual(response, ["408 Request Timeout"])
        self.assertEqual(json.loads(body), {"ok": False, "error": "request-timeout"})

    def test_unknown_database_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "unknown.sqlite"
            with closing(sqlite3.connect(path)) as db:
                db.execute("CREATE TABLE other(value TEXT)")
                db.execute("INSERT INTO other VALUES('preserve')")
                db.commit()
            with self.assertRaises(ValueError):
                Store(path)
            with closing(sqlite3.connect(path)) as db:
                self.assertEqual(db.execute("SELECT value FROM other").fetchone()[0], "preserve")

    def test_public_origin_and_admin_key_configuration(self):
        with self.assertRaises(ValueError):
            Config(Path("unused"), "short")
        with self.assertRaises(ValueError):
            Config(Path("unused"), "x" * 32, public_origin="http://public.example")
        app = Application.__new__(Application)
        app.config = Config(Path("unused"), "x" * 32, public_origin="https://stats.example")
        self.assertIn("; Secure", app.cookie("test"))

    def test_rate_limit_bounds_memory(self):
        limiter = RateLimit()
        self.assertTrue(limiter.allow("sample-ip", "login", 1))
        self.assertFalse(limiter.allow("sample-ip", "login", 1))
        for index in range(5000):
            limiter.allow(str(index), "requests", 1)
        self.assertLessEqual(len(limiter.entries), 4096)

    def test_setup_creates_secret_without_overwriting_it(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            (directory / ".env.example").write_text("DATAHUB_COOKIE_SECURE=0\n")
            key, env = initialize(directory)
            first = key.read_bytes()
            initialize(directory)
            self.assertEqual(key.read_bytes(), first)
            self.assertGreaterEqual(len(first.strip()), 32)
            self.assertNotIn(first.strip(), env.read_bytes())


if __name__ == "__main__":
    unittest.main()
