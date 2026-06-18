<?php
// Triki Games API — PHP port of gryzabka.py
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

define('DATA',  __DIR__ . '/data');
define('GAMES', __DIR__ . '/games');

$route  = preg_replace('#^.*/api#', '', parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));
$method = $_SERVER['REQUEST_METHOD'];

function ok($d)       { echo json_encode($d, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT); exit; }
function err($c)      { http_response_code($c); exit; }
function body()       { return json_decode(file_get_contents('php://input'), true) ?? []; }
function mkd($path)   { if (!is_dir($path)) mkdir($path, 0755, true); }
function now_iso()    { return gmdate('Y-m-d\TH:i:s\Z'); }
function read_json($f){ return file_exists($f) ? json_decode(file_get_contents($f), true) : null; }
function write_json($f, $d) { file_put_contents($f, json_encode($d, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT)); }

// GET /api/games
if (($route === '/games' || $route === '') && $method === 'GET') {
    $games = [];
    if (is_dir(GAMES)) {
        foreach (scandir(GAMES) as $d) {
            if ($d[0] === '.' || $d[0] === '_') continue;
            $meta = GAMES . "/$d/meta.json";
            if (!file_exists($meta)) continue;
            $m = json_decode(file_get_contents($meta), true);
            $m['id'] = $d;
            $games[] = $m;
        }
    }
    usort($games, fn($a, $b) => ($a['order'] ?? 99) <=> ($b['order'] ?? 99));
    ok($games);
}

// /api/scores/{id}
if (preg_match('#^/scores/([a-z0-9_]+)$#', $route, $m)) {
    $f = DATA . '/scores/' . $m[1] . '.json';
    if ($method === 'GET') {
        $scores = read_json($f) ?? [];
        $period = $_GET['period'] ?? 'all';
        if ($period !== 'all') {
            $cutoff = $period === 'today' ? strtotime('today UTC') : strtotime('-7 days');
            $scores = array_values(array_filter($scores, fn($s) => strtotime($s['ts'] ?? '1970') >= $cutoff));
        }
        ok($scores);
    }
    $b = body();
    mkd(DATA . '/scores');
    $scores       = read_json($f) ?? [];
    $b['ts']      = $b['ts'] ?? now_iso();
    $b['score']   = is_numeric($b['score'] ?? null) ? (float)($b['score']) : 0;
    $scores[]     = $b;
    usort($scores, fn($a, $b) => ($b['score'] ?? 0) <=> ($a['score'] ?? 0));
    write_json($f, array_slice($scores, 0, 500));
    ok(['ok' => true]);
}

// /api/players
if ($route === '/players') {
    $f = DATA . '/players.json';
    if ($method === 'GET') {
        ok(read_json($f) ?? (object)[]);
    }
    $b   = body();
    $did = $b['device_id'] ?? null;
    if ($did) {
        mkd(DATA);
        $players  = read_json($f) ?? [];
        $now      = now_iso();
        $existing = $players[$did] ?? [];
        $b['last_seen'] = $b['last_seen'] ?? $now;
        $b['created']   = $b['created']   ?? ($existing['created'] ?? $now);
        unset($b['device_id']);
        $players[$did]  = $b;
        write_json($f, $players);
    }
    ok(['ok' => true]);
}

// GET /api/triki-devices
if ($route === '/triki-devices') {
    $players = read_json(DATA . '/players.json') ?? [];
    $devices = [];
    foreach ($players as $did => $p) {
        $t = $p['triki_name'] ?? null;
        if (!$t) continue;
        $devices[$t] = ['triki_name' => $t, 'nick' => $p['nick'] ?? '?',
                        'color' => $p['color'] ?? '#888', 'last_seen' => $p['last_seen'] ?? null,
                        'device_id' => $did];
    }
    ksort($devices);
    ok(array_values($devices));
}

// POST /api/diag
if ($route === '/diag' && $method === 'POST') {
    $b      = body();
    $device = preg_replace('#[/ ]#', '_', $b['device'] ?? 'triki');
    $fname  = 'diag_' . $device . '_' . gmdate('Ymd_His') . '.json';
    mkd(DATA . '/logs');
    $b['server_ts'] = now_iso();
    file_put_contents(DATA . '/logs/' . $fname, json_encode($b, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    ok(['ok' => true, 'file' => $fname]);
}

// POST /api/log
if ($route === '/log' && $method === 'POST') {
    $b      = body();
    $device = preg_replace('#[/ ]#', '_', $b['device'] ?? 'triki');
    $fname  = 'triki_log_' . $device . '_' . gmdate('Ymd_His') . '.csv';
    mkd(DATA . '/logs');
    $fp = fopen(DATA . '/logs/' . $fname, 'w');
    fputcsv($fp, ['timestamp','frameIndex','gx','gy','gz','ax','ay','az']);
    foreach ($b['samples'] ?? [] as $s) {
        fputcsv($fp, [$s['timestamp'] ?? '', $s['frameIndex'] ?? '',
                      $s['gx'] ?? '', $s['gy'] ?? '', $s['gz'] ?? '',
                      $s['ax'] ?? '', $s['ay'] ?? '', $s['az'] ?? '']);
    }
    fclose($fp);
    ok(['ok' => true, 'file' => $fname, 'samples' => count($b['samples'] ?? [])]);
}

err(404);
