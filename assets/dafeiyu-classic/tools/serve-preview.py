#!/usr/bin/env python3
"""Serve a local review directory with byte ranges for HTML video seeking."""
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
import argparse,re

class RangeHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        self.byte_range=None
        path=Path(self.translate_path(self.path))
        value=self.headers.get('Range')
        if not value or not path.is_file():return super().send_head()
        match=re.fullmatch(r'bytes=(\d*)-(\d*)',value.strip())
        size=path.stat().st_size
        if not match or not size or not any(match.groups()):return self.invalid_range(size)
        left,right=match.groups()
        start=int(left) if left else max(0,size-int(right))
        end=min(size-1,int(right)) if left and right else size-1
        if start>=size or start>end:return self.invalid_range(size)
        f=path.open('rb');f.seek(start);self.byte_range=(start,end)
        self.send_response(206);self.send_header('Content-Type',self.guess_type(str(path)))
        self.send_header('Content-Range',f'bytes {start}-{end}/{size}')
        self.send_header('Content-Length',str(end-start+1));self.end_headers()
        return f
    def invalid_range(self,size):
        self.send_response(416);self.send_header('Content-Range',f'bytes */{size}');self.send_header('Content-Length','0');self.end_headers();return None
    def end_headers(self):
        self.send_header('Accept-Ranges','bytes')
        self.send_header('Cache-Control','no-cache')
        super().end_headers()
    def copyfile(self,source,outputfile):
        if self.byte_range is None:return super().copyfile(source,outputfile)
        remaining=self.byte_range[1]-self.byte_range[0]+1
        while remaining:
            chunk=source.read(min(remaining,512*1024))
            if not chunk:break
            outputfile.write(chunk);remaining-=len(chunk)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--media-root',type=Path,required=True);p.add_argument('--port',type=int,default=8769)
    a=p.parse_args();root=a.media_root.resolve()
    if not (root/'index.html').is_file():p.error('Run build-preview.py first')
    print(f'Review only: http://127.0.0.1:{a.port}',flush=True)
    ThreadingHTTPServer(('127.0.0.1',a.port),partial(RangeHandler,directory=str(root))).serve_forever()
