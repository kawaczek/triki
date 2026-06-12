#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Triki Games Server — stdlib only, no pip required.
Usage: python3 server.py [port]   (default: 8797)
"""
import json, re, sys, pathlib, datetime
from http.server import SimpleHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

BASE = pathlib.Path(__file__).parent
DATA = BASE / 'data'
GAMES = BASE / 'games'

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(BASE), **kw)

    # ── routing ─────────────────────────────────────────
    def do_GET(self):
        p = urlparse(self.path).path
        if p.startswith('/api/'):
            self._api_get(p)
        else:
            super().do_GET()

    def do_POST(self):
        p = urlparse(self.path).path
        if p.startswith('/api/'):
            self._api_post(p)
        else:
            self.send_error(405)

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors(); self.end_headers()

    # ── GET endpoints ───────────────────────────────────
    def _api_get(self, path):
        if path == '/api/games':
            games = []
            if GAMES.exists():
                for d in sorted(GAMES.iterdir()):
                    if d.name.startswith('_'):
                        continue
                    meta = d / 'meta.json'
                    if meta.exists():
                        m = json.loads(meta.read_text('utf-8'))
                        m['id'] = d.name
                        games.append(m)
            games.sort(key=lambda g: g.get('order', 99))
            self._ok(games)

        elif m := re.match(r'^/api/scores/([a-z0-9_]+)$', path):
            f = DATA / 'scores' / f'{m.group(1)}.json'
            self._ok(json.loads(f.read_text('utf-8')) if f.exists() else [])

        elif path == '/api/players':
            f = DATA / 'players.json'
            self._ok(json.loads(f.read_text('utf-8')) if f.exists() else {})

        elif path == '/api/triki-devices':
            f = DATA / 'players.json'
            players = json.loads(f.read_text('utf-8')) if f.exists() else {}
            # build list: triki_name → nick, keyed by triki_name
            devices = {}
            for did, p in players.items():
                tname = p.get('triki_name')
                if tname:
                    devices[tname] = {
                        'triki_name': tname,
                        'nick'      : p.get('nick', '?'),
                        'color'     : p.get('color', '#888'),
                        'last_seen' : p.get('last_seen'),
                        'device_id' : did,
                    }
            self._ok(sorted(devices.values(), key=lambda x: x['triki_name']))

        else:
            self.send_error(404)

    # ── POST endpoints ──────────────────────────────────
    def _api_post(self, path):
        body = self._body()

        if m := re.match(r'^/api/scores/([a-z0-9_]+)$', path):
            gid = m.group(1)
            f = DATA / 'scores' / f'{gid}.json'
            f.parent.mkdir(parents=True, exist_ok=True)
            scores = json.loads(f.read_text('utf-8')) if f.exists() else []
            body.setdefault('ts', datetime.datetime.utcnow().isoformat() + 'Z')
            scores.append(body)
            scores.sort(key=lambda x: x.get('score', 0), reverse=True)
            f.write_text(json.dumps(scores[:500], indent=2, ensure_ascii=False), 'utf-8')
            self._ok({'ok': True})

        elif path == '/api/players':
            f = DATA / 'players.json'
            f.parent.mkdir(parents=True, exist_ok=True)
            players = json.loads(f.read_text('utf-8')) if f.exists() else {}
            did = body.get('device_id')
            if did:
                now = datetime.datetime.utcnow().isoformat() + 'Z'
                body.setdefault('last_seen', now)
                # nowy gracz → ustaw datę rejestracji; istniejący → zachowaj starą
                existing = players.get(did, {})
                body.setdefault('created', existing.get('created', now))
                players[did] = {k: v for k, v in body.items() if k != 'device_id'}
                f.write_text(json.dumps(players, indent=2, ensure_ascii=False), 'utf-8')
            self._ok({'ok': True})

        elif path == '/api/diag':
            # pełna diagnostyka kapsla — zapisuje JSON do data/logs/diag_*.json
            logs_dir = DATA / 'logs'
            logs_dir.mkdir(exist_ok=True)
            device = body.get('device', 'triki').replace('/', '_').replace(' ', '_')
            ts = datetime.datetime.utcnow().strftime('%Y%m%d_%H%M%S')
            fname = f'diag_{device}_{ts}.json'
            body['server_ts'] = datetime.datetime.utcnow().isoformat() + 'Z'
            fpath = logs_dir / fname
            fpath.write_text(json.dumps(body, indent=2, ensure_ascii=False), 'utf-8')
            print(f'[DIAG] zapisano → {fname}')
            self._ok({'ok': True, 'file': fname})

        elif path == '/api/log':
            import csv as _csv
            logs_dir = DATA / 'logs'
            logs_dir.mkdir(exist_ok=True)
            device = body.get('device', 'triki').replace('/', '_').replace(' ', '_')
            ts = datetime.datetime.utcnow().strftime('%Y%m%d_%H%M%S')
            fname = f'triki_log_{device}_{ts}.csv'
            samples = body.get('samples', [])
            with open(logs_dir / fname, 'w', newline='', encoding='utf-8') as f:
                w = _csv.writer(f)
                w.writerow(['timestamp','frameIndex','gx','gy','gz','ax','ay','az'])
                for s in samples:
                    w.writerow([s.get('timestamp'), s.get('frameIndex'),
                                s.get('gx'), s.get('gy'), s.get('gz'),
                                s.get('ax'), s.get('ay'), s.get('az')])
            print(f'[LOG] {len(samples)} samples → {fname}')
            self._ok({'ok': True, 'file': fname, 'samples': len(samples)})

        else:
            self.send_error(404)

    # ── helpers ─────────────────────────────────────────
    def _body(self):
        n = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(n)) if n else {}

    def _ok(self, data):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(body))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def end_headers(self):
        # HTML: zawsze świeże (Cloudflare i przeglądarki nie cachują)
        # Assets z ?v=: cachuj wiecznie (zmieniamy parametr przy deployu)
        p = urlparse(self.path).path
        if p.endswith('.html') or p == '/':
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        elif '?v=' in self.path:
            self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
        super().end_headers()

    def log_message(self, fmt, *args):
        # only log errors and API calls
        if args and (str(args[1]) not in ('200', '304') or '/api/' in str(args[0])):
            super().log_message(fmt, *args)


if __name__ == '__main__':
    DATA.mkdir(exist_ok=True)
    (DATA / 'scores').mkdir(exist_ok=True)
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8797
    srv = HTTPServer(('', port), Handler)
    print(f'Triki Games  →  http://localhost:{port}')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\nStop.')
