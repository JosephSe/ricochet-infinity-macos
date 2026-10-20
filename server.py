#!/usr/bin/env python3
"""Local HTTP server for the native macOS Ricochet Infinity port."""

import argparse
import io
import os
import re
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

RANGE_RE = re.compile(r'bytes=(\d*)-(\d*)$')


class QuietHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.ogg': 'audio/ogg',
        '.png': 'image/png',
        '.ttf': 'font/ttf',
        '.css': 'text/css; charset=utf-8',
    }

    def log_message(self, format, *args):
        pass

    def end_headers(self):
        # Safari/WebKit only plays <audio> from servers that advertise byte-range support.
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def send_head(self):
        range_header = self.headers.get('Range')
        path = self.translate_path(self.path)
        if not range_header or not os.path.isfile(path):
            return super().send_head()

        match = RANGE_RE.match(range_header.strip())
        if not match or (not match.group(1) and not match.group(2)):
            return super().send_head()

        with open(path, 'rb') as f:
            data = f.read()
        size = len(data)
        first, last = match.groups()
        if first:
            start = int(first)
            end = min(int(last), size - 1) if last else size - 1
        else:  # suffix range: the last N bytes
            start = max(0, size - int(last))
            end = size - 1
        if start >= size or end < start:
            self.send_response(416)
            self.send_header('Content-Range', f'bytes */{size}')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return None

        body = data[start : end + 1]
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        return io.BytesIO(body)


class QuietServer(ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        # Browsers routinely abort media requests mid-stream; that is not an error worth a traceback.
        if isinstance(sys.exc_info()[1], ConnectionError):
            return
        super().handle_error(request, client_address)


def main():
    parser = argparse.ArgumentParser(description='Ricochet Infinity macOS Asset Server')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--host', type=str, default='127.0.0.1')
    args = parser.parse_args()

    public_dir = Path(__file__).resolve().parent / 'public'
    handler = partial(QuietHandler, directory=str(public_dir))
    server = QuietServer((args.host, args.port), handler)
    print(f'Ricochet Infinity macOS Server listening on http://{args.host}:{args.port}', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
