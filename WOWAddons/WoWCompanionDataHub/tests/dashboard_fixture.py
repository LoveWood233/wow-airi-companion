"""Temporary, synthetic WSGI fixture for the browser test; no user data or keys."""

import secrets
import sys
import tempfile
import threading
import uuid
from pathlib import Path
from wsgiref.simple_server import WSGIRequestHandler, make_server

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Config, create_app
from store import COUNTERS


class QuietHandler(WSGIRequestHandler):
    def log_message(self, *_args):
        pass


with tempfile.TemporaryDirectory(prefix="wow-datahub-browser-") as directory:
    app = create_app(Config(Path(directory) / "fixture.sqlite", "dashboard-test-only-admin-" + "x" * 48))
    for version in ("2.26.0", "2.25.0", "=1+1", '<img src=x onerror="alert(1)">'):
        identity, secret = str(uuid.uuid4()), secrets.token_urlsafe(32)
        # Bypass public version validation only to exercise defensive DOM/CSV rendering.
        app.store.register(identity, secret, version, "win32")
        counters = {key: 0 for key in COUNTERS}
        counters.update(requests=12, requestsWithUsage=10, requestsWithoutUsage=2,
                        inputTokens=123456, outputTokens=45678, totalTokens=169134,
                        inputReportedRequests=9, outputReportedRequests=8, totalReportedRequests=7)
        app.store.observe(identity, secret, 1, counters)
    server = make_server("127.0.0.1", 0, app, handler_class=QuietHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(server.server_port, flush=True)
    try:
        sys.stdin.readline()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(3)
