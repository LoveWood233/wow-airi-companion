from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import os

ROOT=Path(__file__).resolve().parents[1]
os.chdir(ROOT)
class Handler(SimpleHTTPRequestHandler):
    def do_POST(self):
        destinations={'/capture/portrait.png':'portrait.png','/capture/animation-preview.webm':'animation-preview.webm'}
        name=destinations.get(self.path)
        size=int(self.headers.get('Content-Length','0'))
        if not name or not 0<size<50_000_000:
            self.send_error(400);return
        (ROOT/'output'/name).write_bytes(self.rfile.read(size))
        self.send_response(200);self.end_headers();self.wfile.write(b'ok')
    def end_headers(self):
        self.send_header('Cache-Control','no-store')
        super().end_headers()
print('Preview: http://127.0.0.1:8766/preview/',flush=True)
ThreadingHTTPServer(('127.0.0.1',8766),Handler).serve_forever()
