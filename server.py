#!/usr/bin/env python3
"""Local HTTP server for the native macOS Ricochet Infinity port."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


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


def main():
    parser = argparse.ArgumentParser(description='Ricochet Infinity macOS Asset Server')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--host', type=str, default='127.0.0.1')
    args = parser.parse_args()

    public_dir = Path(__file__).resolve().parent / 'public'
    handler = partial(QuietHandler, directory=str(public_dir))
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f'Ricochet Infinity macOS Server listening on http://{args.host}:{args.port}', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
