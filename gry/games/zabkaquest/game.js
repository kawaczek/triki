// games/zabkaquest/game.js — Żabka Quest (action-RPG)
// Uratuj Księżniczkę Żabkę przed Wielkim Wężem. 12 pokoi, walka, exp, gold,
// ekwipunek, dialogi, sklep, save, boss 3-fazowy.
//
// Sterowanie:
//   triki.GZ()  → poziomo (prawo = +)
//   triki.GX()  → pionowo (dół = +)
//   triki.consumeClick() → atak / interakcja
//   triki.consumeShake() → eliksir
//
// Kontrakt klasy: constructor / start / update / draw / drawIdle / resize / destroy

import { clamp, rand, lerp, pick } from '../../static/gameutils.js';

// ───────────────────────── stałe świata ─────────────────────────
const COLS = 15, ROWS = 11;          // plansza 15×11 kafelków
// kafelki: 0=podłoga, 1=ściana, 2=woda/przepaść, 3=trawa
const W_ = 1, F_ = 0, G_ = 3, P_ = 2;

// helper budujący pokój z obwódką ścian + opcjonalnymi wpisami
function room(fill, edits) {
  const m = [];
  for (let y = 0; y < ROWS; y++) {
    const r = [];
    for (let x = 0; x < COLS; x++) {
      const border = (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1);
      r.push(border ? W_ : fill);
    }
    m.push(r);
  }
  if (edits) edits(m);
  return m;
}
// otwórz przejścia w obwódce (po teleporcie gracz wchodzi przez te otwory)
function openDoors(m, dirs) {
  const mid = (COLS / 2) | 0, midY = (ROWS / 2) | 0;
  if (dirs.north) { m[0][mid - 1] = F_; m[0][mid] = F_; m[0][mid + 1] = F_; }
  if (dirs.south) { m[ROWS - 1][mid - 1] = F_; m[ROWS - 1][mid] = F_; m[ROWS - 1][mid + 1] = F_; }
  if (dirs.east) { m[midY - 1][COLS - 1] = F_; m[midY][COLS - 1] = F_; m[midY + 1][COLS - 1] = F_; }
  if (dirs.west) { m[midY - 1][0] = F_; m[midY][0] = F_; m[midY + 1][0] = F_; }
}

// ───────────────────────── definicje pokoi ──────────────────────
// budujemy proceduralnie, ale stałe i deterministyczne (bez Math.random)
const ROOMS = [];
(function buildRooms() {
  // R0 — Wioska (bezpieczny, podłoga kamienna)
  ROOMS[0] = room(F_, m => {
    openDoors(m, { north: 1 });
    // ozdobne ściany-domki
    m[3][2] = W_; m[3][12] = W_; m[8][6] = W_; m[8][8] = W_;
  });
  // R1 — Północ wioski (trawa)
  ROOMS[1] = room(G_, m => {
    openDoors(m, { south: 1, north: 1 });
    m[5][4] = W_; m[5][10] = W_; m[3][7] = W_;
  });
  // R2 — Skrzyżowanie
  ROOMS[2] = room(F_, m => {
    openDoors(m, { south: 1, north: 1, east: 1 });
    m[3][3] = W_; m[7][11] = W_;
  });
  // R3 — Wejście lasu (trawa, drzewa)
  ROOMS[3] = room(G_, m => {
    openDoors(m, { south: 1, north: 1 });
    m[2][3] = W_; m[2][11] = W_; m[6][6] = W_; m[6][8] = W_; m[8][4] = W_;
  });
  // R4 — Brzeg stawu (woda + mostek)
  ROOMS[4] = room(G_, m => {
    openDoors(m, { west: 1, north: 1 });
    for (let x = 3; x <= 11; x++) m[7][x] = P_;
    m[7][7] = F_; // mostek
  });
  // R5 — Głęboki las (miniboss arena)
  ROOMS[5] = room(G_, m => {
    openDoors(m, { south: 1, east: 1 });
    m[3][4] = W_; m[3][10] = W_; m[8][4] = W_; m[8][10] = W_;
  });
  // R6 — Staw z kłodami
  ROOMS[6] = room(G_, m => {
    openDoors(m, { south: 1, east: 1 });
    for (let x = 2; x <= 12; x++) { m[4][x] = P_; m[8][x] = P_; }
    m[4][7] = F_; m[8][5] = F_; m[8][9] = F_; // kłody
  });
  // R7 — Brama jaskini
  ROOMS[7] = room(F_, m => {
    openDoors(m, { west: 1, north: 1 });
    m[2][7] = W_; m[5][4] = W_; m[5][10] = W_;
  });
  // R8 — Wejście jaskini (mrok)
  ROOMS[8] = room(F_, m => {
    openDoors(m, { south: 1, north: 1 });
    m[4][5] = W_; m[4][9] = W_; m[7][7] = W_;
  });
  // R9 — Sala pułapek (woda + ściany)
  ROOMS[9] = room(F_, m => {
    openDoors(m, { south: 1, north: 1 });
    for (let y = 3; y <= 7; y++) { m[y][4] = P_; m[y][10] = P_; }
    m[5][4] = F_; m[5][10] = F_; // przejścia
    m[3][7] = W_; m[7][7] = W_;
  });
  // R10 — Komnata skarbu
  ROOMS[10] = room(F_, m => {
    openDoors(m, { south: 1, north: 1 });
    m[3][3] = W_; m[3][11] = W_; m[8][3] = W_; m[8][11] = W_;
  });
  // R11 — Komnata bossa
  ROOMS[11] = room(F_, m => {
    openDoors(m, { south: 1 });
    m[2][2] = W_; m[2][12] = W_; m[8][2] = W_; m[8][12] = W_;
  });
})();

// kierunki wyjść między pokojami (indeks pokoju docelowego lub null)
const ROOM_EXITS = [
  { north: 1, south: null, east: null, west: null },  // R0
  { north: 2, south: 0, east: null, west: null },     // R1
  { north: 3, south: 1, east: 4, west: null },        // R2
  { north: 5, south: 2, east: null, west: null },     // R3
  { north: 6, south: null, east: null, west: 2 },     // R4
  { north: null, south: 3, east: 7, west: null },     // R5
  { north: null, south: 4, east: 7, west: null },     // R6
  { north: 8, south: null, east: null, west: 5 },     // R7
  { north: 9, south: 7, east: null, west: null },     // R8
  { north: 10, south: 8, east: null, west: null },    // R9
  { north: 11, south: 9, east: null, west: null },    // R10
  { north: null, south: 10, east: null, west: null }, // R11
];

const ROOM_NAMES = [
  'Wioska Żabek', 'Północ wioski', 'Skrzyżowanie', 'Wejście lasu',
  'Brzeg stawu', 'Głęboki las', 'Staw z kłodami', 'Brama jaskini',
  'Wejście jaskini', 'Sala pułapek', 'Komnata skarbu', 'Komnata Bossa',
];
// 0=wioska, 1=las, 2=jaskinia (paleta podłogi)
const ROOM_BIOME = [0, 1, 0, 1, 1, 1, 1, 0, 2, 2, 2, 2];

// ───────────────────────── wrogowie ─────────────────────────────
const ENEMY_TYPES = {
  bug:       { hp: 5,  atk: 2, def: 0, exp: 10, gold: 2, speed: 60, agro: 150, emoji: '🐛', color: '#84cc16' },
  spider:    { hp: 10, atk: 4, def: 1, exp: 25, gold: 5, speed: 80, agro: 180, emoji: '🕷️', color: '#475569' },
  dragonfly: { hp: 8,  atk: 3, def: 0, exp: 20, gold: 3, speed: 100, agro: 160, emoji: '🦋', color: '#38bdf8' },
  frog_e:    { hp: 12, atk: 5, def: 2, exp: 30, gold: 6, speed: 70, agro: 170, emoji: '😤', color: '#22c55e' },
  snake:     { hp: 15, atk: 7, def: 2, exp: 40, gold: 10, speed: 90, agro: 200, emoji: '🐍', color: '#a16207' },
  guard:     { hp: 20, atk: 6, def: 3, exp: 50, gold: 15, speed: 65, agro: 180, emoji: '💂', color: '#dc2626' },
  big_spider:{ hp: 60, atk: 8, def: 3, exp: 150, gold: 40, speed: 55, agro: 250, emoji: '🕸️', color: '#1e293b', isBoss: true },
  big_snake: { hp: 200, atk: 12, def: 5, exp: 500, gold: 0, speed: 80, agro: 9999, emoji: '👑', color: '#7c3aed', isBoss: true },
};

// rozmieszczenie wrogów per pokój: [typ, kolumna, wiersz]
const ROOM_ENEMIES = {
  1: [['bug', 5, 3], ['bug', 9, 6], ['bug', 7, 8]],
  3: [['spider', 5, 4], ['spider', 10, 5], ['spider', 7, 7]],
  4: [['dragonfly', 4, 3], ['dragonfly', 10, 3], ['dragonfly', 7, 5]],
  5: [['big_spider', 7, 4]],
  6: [['frog_e', 4, 6], ['frog_e', 10, 6], ['frog_e', 7, 2]],
  7: [['guard', 5, 6], ['guard', 9, 6]],
  8: [['snake', 5, 4], ['snake', 9, 4], ['snake', 7, 8]],
  9: [['snake', 3, 5], ['snake', 11, 5], ['snake', 7, 8]],
  11: [['big_snake', 7, 3]],
};

// skrzynie per pokój: [kolumna, wiersz, item]
const ROOM_CHESTS = {
  1: [[12, 2, 'potion']],
  3: [[12, 8, 'iron_sword']],
  7: [[2, 8, 'fire_sword']],
  10: [[7, 5, 'royal_shield']],
};

// NPC w R0: [id, kolumna, wiersz]
const NPCS_R0 = [
  { id: 'elder', x: 3, y: 4, emoji: '🧓', name: 'Stary Żabek' },
  { id: 'merchant', x: 11, y: 4, emoji: '🧙', name: 'Handlarz' },
  { id: 'innkeeper', x: 7, y: 8, emoji: '🍺', name: 'Karczmarz' },
];

const DIALOGS = {
  elder: [
    'Witaj, dzielny wojowniku Żabko!',
    'Wielki Wąż porwał naszą Księżniczkę...',
    'Idź na północ, przez las i jaskinię. Ratuj ją!',
  ],
};

// ekwipunek — bonusy
const WEAPONS = {
  wooden_sword: { atk: 0, name: 'Drewniany miecz' },
  iron_sword: { atk: 3, name: 'Żelazny miecz' },
  fire_sword: { atk: 6, name: 'Miecz Ognia' },
};
const SHIELDS = {
  wooden_shield: { def: 2, name: 'Drewniana tarcza' },
  golden_shield: { def: 4, name: 'Złota tarcza' },
  royal_shield: { def: 6, name: 'Tarcza Królewska' },
};

const ITEM_NAMES = {
  potion: 'Eliksir', iron_sword: 'Żelazny miecz', fire_sword: 'Miecz Ognia',
  royal_shield: 'Tarcza Królewska', wooden_shield: 'Drewniana tarcza',
};

const SAVE_KEY = 'zabkaquest_save';

const SPEED = 150;            // px/s gracza
const ATK_RANGE = 90;         // zasięg ataku gracza
const ATK_CD = 400;           // cooldown ataku gracza (ms)
const SHOP_ITEMS = [
  { id: 'wooden_shield', label: 'Drewniana tarcza (+2 def)', cost: 20, type: 'shield' },
  { id: 'potion', label: 'Eliksir (lecz 10 HP)', cost: 10, type: 'potion' },
];

export default class ZabkaQuestGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.triki = triki;
    this.emit = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;
    this._mx = 0.5; this._my = 0.5;
    this._keys = {};

    this._initState();
  }

  _initState() {
    // gracz
    this.p = {
      hp: 20, maxHp: 20, baseAtk: 5, baseDef: 0,
      exp: 0, expNext: 100, level: 1, gold: 0, potions: 2,
      weapon: 'wooden_sword', shield: null,
      expTotal: 0,
    };
    this.roomIdx = 0;
    this.chestsOpened = {};     // "room:idx" → true
    this.enemiesKilled = {};    // "room:idx" → true (nie respawnują)
    this.totalKilled = 0;

    // pozycja gracza w pikselach
    this._layout();
    this.px = this.W / 2;
    this.py = this.H / 2;
    this.facing = { x: 0, y: 1 };   // kierunek (domyślnie w dół)
    this.lastDir = { x: 0, y: 1 };

    this.enemies = [];
    this.chests = [];
    this.npcs = [];
    this.particles = [];
    this.dmgNumbers = [];
    this.miniSnakes = [];

    this.atkCd = 0;
    this.atkFlash = 0;
    this.playerHitFlash = 0;
    this.water_t = 0;

    this.dialog = null;          // {npc, line}
    this.shop = null;            // {sel}
    this.banner = null;          // {text, t, color}
    this.levelupT = 0;
    this.confetti = [];

    this.mode = 'play';          // play | savePrompt | dead | win
    this.promptT = 0;
    this._pendingSave = null;
    this.score = 0;
    this._gzAcc = 0;             // wygładzanie wejścia
    this._loadRoom(0, null);
  }

  // ───────── layout / kafelki ─────────
  _layout() {
    this.ts = Math.floor(Math.min(this.W, this.H * 0.8) / 15);
    const gw = this.ts * COLS, gh = this.ts * ROWS;
    this.ox = Math.floor((this.W - gw) / 2);
    this.oy = Math.floor((this.H - gh) / 2);
  }

  _map() { return ROOMS[this.roomIdx]; }

  _tileAt(cx, cy) {
    const m = this._map();
    if (cy < 0 || cy >= ROWS || cx < 0 || cx >= COLS) return W_;
    return m[cy][cx];
  }
  // czy kafelek blokuje ruch (ściana lub woda)
  _solid(cx, cy) {
    const t = this._tileAt(cx, cy);
    return t === W_ || t === P_;
  }
  _cellToPx(cx, cy) {
    return { x: this.ox + (cx + 0.5) * this.ts, y: this.oy + (cy + 0.5) * this.ts };
  }

  // ───────── ładowanie pokoju ─────────
  _loadRoom(idx, fromDir) {
    this.roomIdx = idx;
    this._layout();
    this.enemies = [];
    this.chests = [];
    this.npcs = [];
    this.particles = [];
    this.dmgNumbers = [];
    this.miniSnakes = [];
    this.dialog = null;
    this.shop = null;

    // wrogowie
    const defs = ROOM_ENEMIES[idx] || [];
    defs.forEach((d, i) => {
      const key = idx + ':' + i;
      if (this.enemiesKilled[key]) return;
      const [type, cx, cy] = d;
      const t = ENEMY_TYPES[type];
      const pos = this._cellToPx(cx, cy);
      this.enemies.push({
        key, type, ...t,
        hp: t.hp, maxHp: t.hp,
        x: pos.x, y: pos.y,
        vx: 0, vy: 0,
        state: 'patrol',
        dirT: 0, mvx: 0, mvy: 0,
        cd: 0, hitFlash: 0,
        phase: 1, shield: 0, spawnT: 0, shieldCd: 5000,
      });
    });

    // skrzynie
    const chs = ROOM_CHESTS[idx] || [];
    chs.forEach((c, i) => {
      const [cx, cy, item] = c;
      const pos = this._cellToPx(cx, cy);
      this.chests.push({ key: idx + ':' + i, x: pos.x, y: pos.y, item, opened: !!this.chestsOpened[idx + ':' + i] });
    });

    // NPC (tylko R0)
    if (idx === 0) {
      NPCS_R0.forEach(n => {
        const pos = this._cellToPx(n.x, n.y);
        this.npcs.push({ ...n, px: pos.x, py: pos.y });
      });
    }

    // pozycja wejścia gracza
    const mid = this._cellToPx((COLS / 2) | 0, (ROWS / 2) | 0);
    if (fromDir === 'north') { this.px = mid.x; this.py = this.oy + (ROWS - 1.5) * this.ts; }
    else if (fromDir === 'south') { this.px = mid.x; this.py = this.oy + 1.5 * this.ts; }
    else if (fromDir === 'east') { this.px = this.ox + (COLS - 1.5) * this.ts; this.py = mid.y; }
    else if (fromDir === 'west') { this.px = this.ox + 1.5 * this.ts; this.py = mid.y; }
    else { this.px = mid.x; this.py = this.oy + (ROWS - 2) * this.ts; }

    this.banner = { text: ROOM_NAMES[idx], t: 1600, color: '#fcd34d' };
  }

  // ───────── save / load ─────────
  _save() {
    const s = {
      hp: this.p.hp, gold: this.p.gold, potions: this.p.potions,
      weapon: this.p.weapon, shield: this.p.shield, room: this.roomIdx,
      exp: this.p.exp, expNext: this.p.expNext, expTotal: this.p.expTotal,
      level: this.p.level, maxHp: this.p.maxHp, baseAtk: this.p.baseAtk,
      baseDef: this.p.baseDef,
      chests_opened: this.chestsOpened, enemies_killed: this.enemiesKilled,
      totalKilled: this.totalKilled,
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (_) {}
  }
  _applySave(s) {
    this.p.hp = s.hp; this.p.gold = s.gold; this.p.potions = s.potions;
    this.p.weapon = s.weapon || 'wooden_sword'; this.p.shield = s.shield || null;
    this.p.exp = s.exp || 0; this.p.expNext = s.expNext || 100;
    this.p.expTotal = s.expTotal || 0;
    this.p.level = s.level || 1; this.p.maxHp = s.maxHp || 20;
    this.p.baseAtk = s.baseAtk || 5; this.p.baseDef = s.baseDef || 0;
    this.chestsOpened = s.chests_opened || {};
    this.enemiesKilled = s.enemies_killed || {};
    this.totalKilled = s.totalKilled || 0;
    this._loadRoom(s.room || 0, null);
  }
  _clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (_) {} }

  // ───────── derived stats ─────────
  get atk() { return this.p.baseAtk + (WEAPONS[this.p.weapon]?.atk || 0); }
  get def() { return this.p.baseDef + (this.p.shield ? (SHIELDS[this.p.shield]?.def || 0) : 0); }

  // ───────── lifecycle ─────────
  start(player) {
    this.player = player;
    this._initState();
    this.running = true;

    // sprawdź zapis
    let saved = null;
    try { const s = localStorage.getItem(SAVE_KEY); if (s) saved = JSON.parse(s); } catch (_) {}
    if (saved) {
      this._pendingSave = saved;
      this.mode = 'savePrompt';
      this.promptT = 3000;
    } else {
      this.mode = 'play';
    }
    this._emitStats();
  }

  resize(W, H) {
    const oldOx = this.ox, oldOy = this.oy, oldTs = this.ts;
    this.W = W; this.H = H;
    // zachowaj względną pozycję gracza w siatce
    const relX = oldTs ? (this.px - oldOx) / oldTs : 7.5;
    const relY = oldTs ? (this.py - oldOy) / oldTs : 9;
    this._layout();
    this.px = this.ox + relX * this.ts;
    this.py = this.oy + relY * this.ts;
    // przelicz pozycje statycznych obiektów
    this._loadRoom(this.roomIdx, null);
  }

  onMouseMove(nx, ny) { this._mx = nx; this._my = ny; }
  onClick() { this._clickQueued = true; }
  onKeyDown(code) { this._keys[code] = true; }
  onKeyUp(code) { this._keys[code] = false; }

  // wejście kierunkowe znormalizowane do [-1,1]
  _input() {
    let h = 0, v = 0;
    if (this.triki.connected) {
      // Konwencja projektu: horizontal = -GZ() (prawo=+), vertical = +GX() (dół=+)
      h = clamp(-this.triki.GZ() / 8, -1, 1);
      v = clamp(this.triki.GX() / 8, -1, 1);
    } else {
      if (this._keys.ArrowLeft || this._keys.KeyA) h -= 1;
      if (this._keys.ArrowRight || this._keys.KeyD) h += 1;
      if (this._keys.ArrowUp || this._keys.KeyW) v -= 1;
      if (this._keys.ArrowDown || this._keys.KeyS) v += 1;
      if (!h && !v) {
        // mysz: idź do kursora
        const tx = this._mx * this.W, ty = this._my * this.H;
        h = clamp((tx - this.px) / 40, -1, 1);
        v = clamp((ty - this.py) / 40, -1, 1);
      }
    }
    return { h, v };
  }

  _click() {
    const fromTriki = this.triki.connected ? this.triki.consumeClick() : false;
    const fromMouse = this._clickQueued; this._clickQueued = false;
    return fromTriki || fromMouse;
  }
  _shake() {
    return this.triki.connected ? this.triki.consumeShake() : !!this._keys.Space && (this._keys.Space = false, true);
  }

  // kolizja prostokąta gracza z mapą
  _canMoveTo(nx, ny) {
    const hw = this.ts * 0.3, hh = this.ts * 0.4;
    const corners = [
      [nx - hw, ny - hh], [nx + hw, ny - hh],
      [nx - hw, ny + hh], [nx + hw, ny + hh],
    ];
    for (const [cx, cy] of corners) {
      const tx = Math.floor((cx - this.ox) / this.ts);
      const ty = Math.floor((cy - this.oy) / this.ts);
      if (this._solid(tx, ty)) return false;
    }
    return true;
  }

  // ───────── update ─────────
  update(dt) {
    if (!this.running) return;
    this.water_t += dt;

    if (this.mode === 'savePrompt') {
      this.promptT -= dt;
      if (this._click()) {
        this._applySave(this._pendingSave);
        this.mode = 'play';
        this._emitStats();
        return;
      }
      if (this.promptT <= 0) {
        // ignoruj zapis — nowa gra
        this._clearSave();
        this.mode = 'play';
      }
      return;
    }
    if (this.mode === 'dead' || this.mode === 'win') {
      this.promptT -= dt;
      this.confetti.forEach(c => { c.x += c.vx * dt / 16; c.y += c.vy * dt / 16; c.vy += 0.15; });
      if (this.promptT <= 0) this._finish();
      return;
    }

    const ds = dt / 1000;
    this.atkCd = Math.max(0, this.atkCd - dt);
    this.atkFlash = Math.max(0, this.atkFlash - dt);
    this.playerHitFlash = Math.max(0, this.playerHitFlash - dt);
    if (this.levelupT > 0) this.levelupT -= dt;
    if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = null; }

    // sklep / dialog mają priorytet wejścia
    if (this.shop) { this._updateShop(); return; }
    if (this.dialog) {
      if (this._click()) {
        this.dialog.line++;
        const lines = DIALOGS[this.dialog.npc.id];
        if (!lines || this.dialog.line >= lines.length) {
          // przejście do akcji NPC
          this._npcAction(this.dialog.npc);
        }
      }
      return;
    }

    // eliksir (shake)
    if (this._shake()) this._usePotion();

    // ruch
    const inp = this._input();
    const len = Math.hypot(inp.h, inp.v);
    if (len > 0.12) {
      const nx = inp.h / Math.max(len, 1), ny = inp.v / Math.max(len, 1);
      this.lastDir = { x: nx, y: ny };
      const move = SPEED * ds;
      const tryX = this.px + nx * move;
      if (this._canMoveTo(tryX, this.py)) this.px = tryX;
      const tryY = this.py + ny * move;
      if (this._canMoveTo(this.px, tryY)) this.py = tryY;
    }

    // przejścia między pokojami (krawędź ekranu w obrębie drzwi)
    this._checkRoomTransition();

    // interakcja / atak
    if (this._click()) this._interact();

    // wrogowie
    this._updateEnemies(dt, ds);
    this._updateMiniSnakes(dt, ds);

    // particle + dmg numbers
    this._updateFx(dt);

    // śmierć gracza
    if (this.p.hp <= 0) {
      this.p.hp = 0;
      this._die();
      return;
    }

    this._emitStats();
  }

  _checkRoomTransition() {
    const exits = ROOM_EXITS[this.roomIdx];
    const margin = this.ts * 0.5;
    const left = this.ox, right = this.ox + COLS * this.ts;
    const top = this.oy, bottom = this.oy + ROWS * this.ts;
    let dir = null, dest = null;
    if (this.py <= top + margin && exits.north != null) { dir = 'south'; dest = exits.north; }
    else if (this.py >= bottom - margin && exits.south != null) { dir = 'north'; dest = exits.south; }
    else if (this.px <= left + margin && exits.west != null) { dir = 'east'; dest = exits.west; }
    else if (this.px >= right - margin && exits.east != null) { dir = 'west'; dest = exits.east; }
    if (dest != null) {
      this._save();
      this._loadRoom(dest, dir);
    }
  }

  // ───────── interakcja (NPC/skrzynia) lub atak ─────────
  _interact() {
    // NPC w zasięgu?
    for (const n of this.npcs) {
      if (Math.hypot(this.px - n.px, this.py - n.py) < 60) {
        if (n.id === 'merchant') { this.shop = { sel: 0 }; return; }
        if (n.id === 'innkeeper') { this._innkeeper(); return; }
        this.dialog = { npc: n, line: 0 };
        return;
      }
    }
    // skrzynia w zasięgu?
    for (const c of this.chests) {
      if (!c.opened && Math.hypot(this.px - c.x, this.py - c.y) < 60) {
        c.opened = true;
        this.chestsOpened[c.key] = true;
        this._giveItem(c.item);
        this._save();
        return;
      }
    }
    // inaczej: atak
    this._attack();
  }

  _attack() {
    if (this.atkCd > 0) return;
    this.atkCd = ATK_CD;
    this.atkFlash = 200;
    const dir = this.lastDir;
    const tx = this.px + dir.x * ATK_RANGE * 0.6;
    const ty = this.py + dir.y * ATK_RANGE * 0.6;
    let hit = false;
    for (const e of this.enemies) {
      if (Math.hypot(e.x - tx, e.y - ty) < ATK_RANGE) {
        const dmg = Math.max(1, this.atk - e.def) + Math.round(rand(-2, 2));
        e.hp -= dmg;
        e.hitFlash = 150;
        this._dmgNum(e.x, e.y - this.ts * 0.5, '-' + dmg, '#ef4444');
        this._spark(e.x, e.y, e.color);
        hit = true;
        if (e.hp <= 0) this._killEnemy(e);
      }
    }
    if (!hit) this._spark(tx, ty, '#cbd5e1', 4);
  }

  _killEnemy(e) {
    const wasBoss = e.type === 'big_snake';
    this.p.exp += e.exp; this.p.expTotal += e.exp;
    this.p.gold += e.gold;
    this.totalKilled++;
    if (e.key) this.enemiesKilled[e.key] = true;
    this._dmgNum(e.x, e.y, '+' + e.exp + ' EXP', '#22c55e');
    for (let i = 0; i < 10; i++) this._spark(e.x, e.y, e.color, 6);
    this.enemies = this.enemies.filter(x => x !== e);
    this._checkLevelUp();
    if (wasBoss) { this._win(); return; }
    this._save();
  }

  _checkLevelUp() {
    while (this.p.exp >= this.p.expNext) {
      this.p.exp -= this.p.expNext;
      this.p.level++;
      this.p.maxHp += 5;
      this.p.baseAtk += 2;
      this.p.hp = this.p.maxHp;
      this.p.expNext = Math.round(100 * Math.pow(1.5, this.p.level - 1));
      this.levelupT = 2000;
      this.banner = { text: 'LEVEL UP!  Lv.' + this.p.level, t: 2000, color: '#fcd34d' };
    }
  }

  _giveItem(item) {
    if (item === 'potion') {
      this.p.potions = Math.min(9, this.p.potions + 1);
      this.banner = { text: '+1 Eliksir', t: 1400, color: '#22c55e' };
    } else if (WEAPONS[item]) {
      this.p.weapon = item;
      this.banner = { text: 'Zdobyto: ' + WEAPONS[item].name + '!', t: 1800, color: '#fcd34d' };
    } else if (SHIELDS[item]) {
      this.p.shield = item;
      this.banner = { text: 'Zdobyto: ' + SHIELDS[item].name + '!', t: 1800, color: '#60a5fa' };
    }
    this._emitStats();
  }

  _usePotion() {
    if (this.p.potions <= 0 || this.p.hp >= this.p.maxHp) return;
    this.p.potions--;
    const heal = 10;
    this.p.hp = Math.min(this.p.maxHp, this.p.hp + heal);
    this._dmgNum(this.px, this.py - this.ts * 0.6, '+' + heal, '#22c55e');
    for (let i = 0; i < 8; i++) this._spark(this.px, this.py, '#34d399', 5);
    this._emitStats();
  }

  // ───────── NPC akcje ─────────
  _npcAction(npc) {
    this.dialog = null; // elder po prostu kończy
  }
  _innkeeper() {
    if (this.p.hp >= this.p.maxHp) {
      this.dialog = { npc: { id: 'innkeeper', name: 'Karczmarz' }, line: 0, custom: 'Jesteś już w pełni sił!' };
      return;
    }
    if (!this._freeHealUsed) {
      this._freeHealUsed = true;
      this.p.hp = this.p.maxHp;
      this.banner = { text: 'Wyleczono za darmo!', t: 1600, color: '#22c55e' };
    } else if (this.p.gold >= 15) {
      this.p.gold -= 15;
      this.p.hp = this.p.maxHp;
      this.banner = { text: 'Wyleczono (-15g)', t: 1600, color: '#22c55e' };
    } else {
      this.banner = { text: 'Brak złota (15g)', t: 1600, color: '#ef4444' };
    }
    this._emitStats();
  }

  // ───────── sklep ─────────
  _updateShop() {
    // nawigacja GZ (prawo/lewo) zmienia wybór, click kupuje, shake/ruch w dół zamyka
    const inp = this._input();
    if (!this._shopCool) this._shopCool = 0;
    this._shopCool = Math.max(0, this._shopCool - 16);
    if (this._shopCool === 0) {
      if (inp.h > 0.4) { this.shop.sel = Math.min(SHOP_ITEMS.length, this.shop.sel + 1); this._shopCool = 250; }
      else if (inp.h < -0.4) { this.shop.sel = Math.max(0, this.shop.sel - 1); this._shopCool = 250; }
    }
    if (this._click()) {
      if (this.shop.sel >= SHOP_ITEMS.length) { this.shop = null; return; } // "Wyjdź"
      this._buy(SHOP_ITEMS[this.shop.sel]);
    }
    if (this._shake()) this.shop = null;
  }
  _buy(item) {
    if (this.p.gold < item.cost) { this.banner = { text: 'Za mało złota!', t: 1200, color: '#ef4444' }; return; }
    if (item.type === 'potion' && this.p.potions >= 5) { this.banner = { text: 'Max 5 eliksirów!', t: 1200, color: '#ef4444' }; return; }
    if (item.type === 'shield' && this.p.shield) { this.banner = { text: 'Masz już tarczę!', t: 1200, color: '#ef4444' }; return; }
    this.p.gold -= item.cost;
    if (item.type === 'potion') this.p.potions++;
    else if (item.type === 'shield') this.p.shield = item.id;
    this.banner = { text: 'Kupiono!', t: 1000, color: '#22c55e' };
    this._emitStats();
  }

  // ───────── wrogowie AI ─────────
  _updateEnemies(dt, ds) {
    for (const e of this.enemies) {
      e.hitFlash = Math.max(0, e.hitFlash - dt);
      e.cd = Math.max(0, e.cd - dt);
      const dx = this.px - e.x, dy = this.py - e.y;
      const dist = Math.hypot(dx, dy);

      // boss fazy
      if (e.type === 'big_snake') this._bossLogic(e, dt, dist);

      let spd = e.speed;
      if (e.type === 'big_snake') spd *= (e.phase === 3 ? 1.6 : e.phase === 2 ? 1.3 : 1.0);

      if (dist < e.agro && e.state !== 'attack') e.state = 'chase';
      if (e.state === 'chase' || e.type === 'big_snake') {
        if (dist > 1) { e.mvx = dx / dist; e.mvy = dy / dist; }
        if (dist < 50 && e.cd === 0) {
          // atak
          let atkCd = 1500;
          if (e.type === 'big_snake') atkCd = e.phase === 3 ? 700 : e.phase === 2 ? 1000 : 1500;
          e.cd = atkCd;
          this._damagePlayer(e.atk);
        }
      } else {
        // patrol
        e.dirT -= dt;
        if (e.dirT <= 0) {
          e.dirT = 2000;
          const a = rand(0, Math.PI * 2);
          e.mvx = Math.cos(a); e.mvy = Math.sin(a);
          if (Math.random() < 0.3) { e.mvx = 0; e.mvy = 0; } // czasem stój
        }
      }

      // ruch z prymitywną kolizją (nie wchodź w ściany)
      const move = spd * ds;
      const nx = e.x + e.mvx * move;
      if (!this._solidAtPx(nx, e.y)) e.x = nx; else e.mvx *= -1;
      const ny = e.y + e.mvy * move;
      if (!this._solidAtPx(e.x, ny)) e.y = ny; else e.mvy *= -1;
      // trzymaj w granicach
      e.x = clamp(e.x, this.ox + this.ts, this.ox + (COLS - 1) * this.ts);
      e.y = clamp(e.y, this.oy + this.ts, this.oy + (ROWS - 1) * this.ts);
    }
  }

  _solidAtPx(x, y) {
    const tx = Math.floor((x - this.ox) / this.ts);
    const ty = Math.floor((y - this.oy) / this.ts);
    return this._solid(tx, ty);
  }

  _bossLogic(e, dt, dist) {
    // ustal fazę
    const newPhase = e.hp > 130 ? 1 : e.hp >= 70 ? 2 : 3;
    if (newPhase !== e.phase) {
      e.phase = newPhase;
      this.banner = { text: 'Wąż wpada w furię! Faza ' + newPhase, t: 1500, color: '#ef4444' };
    }
    // faza 2: mini-węże co 3s
    if (e.phase >= 2) {
      e.spawnT -= dt;
      if (e.spawnT <= 0) {
        e.spawnT = 3000;
        for (let i = 0; i < 2; i++) {
          this.miniSnakes.push({
            x: e.x + rand(-40, 40), y: e.y + rand(-40, 40),
            hp: 5, atk: 3, speed: 110, cd: 0, hitFlash: 0,
          });
        }
      }
    }
    // faza 3: tarcza 2s co 5s (def+10)
    if (e.phase === 3) {
      e.shieldCd -= dt;
      if (e.shield > 0) { e.shield -= dt; e.def = 5 + (e.shield > 0 ? 10 : 0); }
      if (e.shieldCd <= 0) { e.shieldCd = 5000; e.shield = 2000; }
      e.def = 5 + (e.shield > 0 ? 10 : 0);
    }
  }

  _updateMiniSnakes(dt, ds) {
    for (const m of this.miniSnakes) {
      m.hitFlash = Math.max(0, m.hitFlash - dt);
      m.cd = Math.max(0, m.cd - dt);
      const dx = this.px - m.x, dy = this.py - m.y;
      const dist = Math.hypot(dx, dy) || 1;
      m.x += dx / dist * m.speed * ds;
      m.y += dy / dist * m.speed * ds;
      if (dist < 45 && m.cd === 0) { m.cd = 1200; this._damagePlayer(m.atk); }
    }
    // mini-węże można zabić atakiem gracza — sprawdzane przy _attack? robimy tu
    if (this.atkFlash > 180) { // świeżo po ataku
      const dir = this.lastDir;
      const tx = this.px + dir.x * ATK_RANGE * 0.6, ty = this.py + dir.y * ATK_RANGE * 0.6;
      this.miniSnakes = this.miniSnakes.filter(m => {
        if (Math.hypot(m.x - tx, m.y - ty) < ATK_RANGE) {
          const dmg = Math.max(1, this.atk);
          m.hp -= dmg;
          if (m.hp <= 0) { this._spark(m.x, m.y, '#a16207', 5); return false; }
        }
        return true;
      });
    }
  }

  _damagePlayer(raw) {
    const dmg = Math.max(1, raw - this.def);
    this.p.hp -= dmg;
    this.playerHitFlash = 150;
    this._dmgNum(this.px, this.py - this.ts * 0.6, '-' + dmg, '#ef4444');
    this._emitStats();
  }

  // ───────── efekty ─────────
  _spark(x, y, color, n = 1) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(0.5, 3);
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 400, max: 400, color });
    }
  }
  _dmgNum(x, y, text, color) {
    this.dmgNumbers.push({ x, y, text, color, life: 900 });
  }
  _updateFx(dt) {
    this.particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.life -= dt; });
    this.particles = this.particles.filter(p => p.life > 0);
    this.dmgNumbers.forEach(d => { d.y -= dt * 0.03; d.life -= dt; });
    this.dmgNumbers = this.dmgNumbers.filter(d => d.life > 0);
  }

  // ───────── koniec ─────────
  _die() {
    this.mode = 'dead';
    this.promptT = 2600;
    this._clearSave();
  }
  _win() {
    this.mode = 'win';
    this.promptT = 3500;
    this._clearSave();
    // confetti
    for (let i = 0; i < 120; i++) {
      this.confetti.push({
        x: rand(0, this.W), y: rand(-this.H, 0),
        vx: rand(-2, 2), vy: rand(1, 4),
        c: pick(['#fcd34d', '#22c55e', '#60a5fa', '#f472b6', '#f97316']),
        s: rand(4, 9),
      });
    }
  }
  _score() {
    const won = this.mode === 'win';
    return this.p.expTotal + this.p.gold * 2 + this.p.level * 100 + (won ? 500 : 0);
  }
  _finish() {
    if (this._finished) return;
    this._finished = true;
    this.running = false;
    const won = this.mode === 'win';
    this.emit('end', { score: this._score(), won });
  }

  // ───────── HUD stats (pasek nagłówka) ─────────
  _emitStats() {
    const hearts = Math.ceil(this.p.maxHp / 5);
    let hp = '';
    const full = Math.round(this.p.hp / this.p.maxHp * hearts);
    for (let i = 0; i < hearts; i++) hp += i < full ? '❤️' : '🖤';
    this.emit('stats',
      `Lv.<b>${this.p.level}</b> ${hp} &nbsp;·&nbsp; ` +
      `💰<b>${this.p.gold}</b> &nbsp; 🧪<b>${this.p.potions}</b> &nbsp;·&nbsp; ` +
      `⚔️<b>${this.atk}</b> 🛡️<b>${this.def}</b>`);
  }

  // ───────────────────────── RENDER ─────────────────────────
  draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, W, H);

    if (this.mode === 'savePrompt') { this._drawWorld(); this._drawSavePrompt(); return; }

    this._drawWorld();
    this._drawHUD();

    if (this.shop) this._drawShop();
    if (this.dialog) this._drawDialog();
    if (this.banner) this._drawBanner();
    if (this.levelupT > 0) this._drawLevelGlow();

    if (this.mode === 'dead') this._drawDeath();
    if (this.mode === 'win') this._drawWin();
  }

  drawIdle() {
    // statyczny podgląd pierwszego pokoju
    this.draw();
  }

  _floorColors() {
    const biome = ROOM_BIOME[this.roomIdx];
    if (biome === 1) return { floor: '#2d5016', wall: '#1c3309', wallTop: '#3a6b1c' };
    if (biome === 2) return { floor: '#1a1a2e', wall: '#0d0d1a', wallTop: '#2a2a44' };
    return { floor: '#8B7355', wall: '#5c4d39', wallTop: '#a08868' };
  }

  _drawWorld() {
    const { ctx, ts, ox, oy } = this;
    const m = this._map();
    const col = this._floorColors();

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const tx = ox + x * ts, ty = oy + y * ts;
        const t = m[y][x];
        if (t === W_) {
          ctx.fillStyle = col.wall;
          ctx.fillRect(tx, ty, ts + 1, ts + 1);
          ctx.fillStyle = col.wallTop;
          ctx.fillRect(tx, ty, ts + 1, ts * 0.22);
        } else if (t === P_) {
          // woda animowana
          const off = Math.sin(this.water_t * 0.003 + x * 0.7 + y * 0.5) * 0.5 + 0.5;
          ctx.fillStyle = '#1e90ff';
          ctx.fillRect(tx, ty, ts + 1, ts + 1);
          ctx.fillStyle = `rgba(255,255,255,${0.06 + off * 0.08})`;
          ctx.fillRect(tx, ty + ts * 0.3, ts + 1, ts * 0.15);
        } else if (t === G_) {
          ctx.fillStyle = col.floor;
          ctx.fillRect(tx, ty, ts + 1, ts + 1);
          // tufty trawy
          ctx.fillStyle = 'rgba(255,255,255,0.04)';
          if ((x + y) % 3 === 0) ctx.fillRect(tx + ts * 0.4, ty + ts * 0.4, ts * 0.18, ts * 0.18);
        } else {
          ctx.fillStyle = col.floor;
          ctx.fillRect(tx, ty, ts + 1, ts + 1);
        }
      }
    }

    // skrzynie
    for (const c of this.chests) {
      ctx.save();
      ctx.fillStyle = c.opened ? '#6b7280' : '#B8860B';
      const s = ts * 0.6;
      ctx.fillRect(c.x - s / 2, c.y - s / 2, s, s);
      ctx.font = `${ts * 0.5}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(c.opened ? '📭' : '📦', c.x, c.y);
      ctx.restore();
    }

    // NPC
    for (const n of this.npcs) {
      ctx.beginPath();
      ctx.fillStyle = '#93c5fd';
      ctx.arc(n.px, n.py, ts * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.font = `${ts * 0.55}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(n.emoji, n.px, n.py);
      // znacznik interakcji gdy blisko
      if (Math.hypot(this.px - n.px, this.py - n.py) < 60) {
        ctx.fillStyle = '#fcd34d';
        ctx.font = `bold ${ts * 0.4}px Outfit,sans-serif`;
        ctx.fillText('💬', n.px, n.py - ts * 0.7);
      }
    }

    // wrogowie
    for (const e of this.enemies) this._drawEnemy(e);
    // mini-węże
    for (const mm of this.miniSnakes) {
      ctx.beginPath();
      ctx.fillStyle = mm.hitFlash > 0 ? '#fff' : '#a16207';
      ctx.arc(mm.x, mm.y, ts * 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `${ts * 0.3}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🐍', mm.x, mm.y);
    }

    // gracz
    this._drawPlayer();

    // particle
    for (const p of this.particles) {
      ctx.globalAlpha = p.life / p.max;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    // attack sweep flash
    if (this.atkFlash > 0) {
      const dir = this.lastDir;
      const ax = this.px + dir.x * ATK_RANGE * 0.5, ay = this.py + dir.y * ATK_RANGE * 0.5;
      ctx.save();
      ctx.globalAlpha = (this.atkFlash / 200) * 0.5;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(ax, ay, ATK_RANGE * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // damage numbers
    for (const d of this.dmgNumbers) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, d.life / 400);
      ctx.fillStyle = d.color;
      ctx.font = `bold ${Math.round(ts * 0.45)}px Outfit,sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(d.text, d.x, d.y);
      ctx.restore();
    }
  }

  _drawEnemy(e) {
    const { ctx, ts } = this;
    const r = e.isBoss ? ts * 0.7 : ts * 0.38;
    ctx.save();
    if (e.shield > 0) {
      ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(e.x, e.y, r + 6, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.beginPath();
    ctx.fillStyle = e.hitFlash > 0 ? '#fff' : e.color;
    ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `${r * 1.2}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(e.emoji, e.x, e.y);
    // pasek hp nad zwykłym wrogiem
    if (!e.isBoss) {
      const bw = ts * 0.8;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(e.x - bw / 2, e.y - r - 8, bw, 4);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(e.x - bw / 2, e.y - r - 8, bw * (e.hp / e.maxHp), 4);
    }
    ctx.restore();
  }

  _drawPlayer() {
    const { ctx, ts } = this;
    const r = ts * 0.4;
    if (this.playerHitFlash > 0) {
      ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = '#fff';
      ctx.fillRect(this.px - r, this.py - r, r * 2, r * 2); ctx.restore();
    }
    ctx.beginPath();
    ctx.fillStyle = this.playerHitFlash > 0 ? '#fca5a5' : '#22c55e';
    ctx.arc(this.px, this.py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#14532d'; ctx.lineWidth = 2; ctx.stroke();
    // oczy
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(this.px - r * 0.3, this.py - r * 0.2, r * 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(this.px + r * 0.3, this.py - r * 0.2, r * 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(this.px - r * 0.3, this.py - r * 0.2, r * 0.1, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(this.px + r * 0.3, this.py - r * 0.2, r * 0.1, 0, Math.PI * 2); ctx.fill();
    // trójkąt kierunku
    const d = this.lastDir;
    const ang = Math.atan2(d.y, d.x);
    ctx.save();
    ctx.translate(this.px + d.x * r, this.py + d.y * r);
    ctx.rotate(ang);
    ctx.fillStyle = '#bbf7d0';
    ctx.beginPath();
    ctx.moveTo(r * 0.5, 0); ctx.lineTo(0, -r * 0.3); ctx.lineTo(0, r * 0.3);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // ───────── HUD ─────────
  _drawHUD() {
    const { ctx, W, H } = this;
    // boss HP bar
    const boss = this.enemies.find(e => e.type === 'big_snake');
    if (boss) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(20, 12, W - 40, 22);
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(20, 12, (W - 40) * (boss.hp / boss.maxHp), 22);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(20, 12, W - 40, 22);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px Outfit,sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('👑 WIELKI WĄŻ', W / 2, 23);
    }

    const top = boss ? 44 : 12;
    // serca
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const hearts = Math.ceil(this.p.maxHp / 5);
    const full = Math.round(this.p.hp / this.p.maxHp * hearts);
    ctx.font = '16px serif';
    let hx = 16;
    for (let i = 0; i < hearts; i++) { ctx.fillText(i < full ? '❤️' : '🖤', hx, top); hx += 18; }

    // EXP bar
    const ebx = 16, eby = top + 24, ebw = 140, ebh = 8;
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(ebx, eby, ebw, ebh);
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(ebx, eby, ebw * clamp(this.p.exp / this.p.expNext, 0, 1), ebh);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1; ctx.strokeRect(ebx, eby, ebw, ebh);
    // LVL badge
    ctx.fillStyle = '#fcd34d';
    ctx.font = 'bold 12px Outfit,sans-serif';
    ctx.fillText('Lv.' + this.p.level, ebx + ebw + 8, eby - 2);

    // prawy górny: gold + potions
    ctx.textAlign = 'right';
    ctx.font = 'bold 15px Outfit,sans-serif';
    ctx.fillStyle = '#fcd34d';
    ctx.fillText('💰 ' + this.p.gold, W - 16, top);
    ctx.fillStyle = '#86efac';
    ctx.fillText('🧪 ' + this.p.potions, W - 16, top + 20);

    // dolny: nazwa obszaru + minimapa
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 13px Outfit,sans-serif';
    ctx.fillText(ROOM_NAMES[this.roomIdx], W / 2, H - 24);

    // minimapa 6×5 px na pokój — układ 3 kolumny × 4 wiersze (12 pokoi)
    const cellW = 8, cellH = 6, gap = 2;
    const cols = 3, rowsM = 4;
    const mw = cols * (cellW + gap), mh = rowsM * (cellH + gap);
    const mxs = W - mw - 12, mys = H - mh - 12;
    for (let i = 0; i < 12; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      const mxp = mxs + c * (cellW + gap), myp = mys + (rowsM - 1 - r) * (cellH + gap);
      ctx.fillStyle = i === this.roomIdx ? '#22c55e' : 'rgba(255,255,255,0.25)';
      ctx.fillRect(mxp, myp, cellW, cellH);
    }
  }

  // ───────── overlay'e ─────────
  _drawBanner() {
    const { ctx, W, H } = this;
    ctx.save();
    ctx.globalAlpha = Math.min(1, this.banner.t / 400);
    ctx.fillStyle = this.banner.color;
    ctx.font = `800 ${Math.round(Math.min(W / 12, 36))}px Outfit,sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = this.banner.color; ctx.shadowBlur = 18;
    ctx.fillText(this.banner.text, W / 2, H * 0.28);
    ctx.restore();
  }

  _drawLevelGlow() {
    const { ctx, W, H } = this;
    ctx.save();
    ctx.globalAlpha = Math.min(0.4, this.levelupT / 2000 * 0.4);
    const g = ctx.createRadialGradient(this.px, this.py, 0, this.px, this.py, this.ts * 4);
    g.addColorStop(0, '#fcd34d'); g.addColorStop(1, 'rgba(252,211,77,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  _drawDialog() {
    const { ctx, W, H } = this;
    const lines = DIALOGS[this.dialog.npc.id];
    const text = this.dialog.custom || (lines ? lines[Math.min(this.dialog.line, lines.length - 1)] : '...');
    const name = this.dialog.npc.name || '';
    const bw = Math.min(W - 40, 420), bh = 90;
    const bx = (W - bw) / 2, by = H - bh - 50;
    ctx.fillStyle = 'rgba(10,12,22,0.92)';
    ctx.strokeStyle = '#fcd34d'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 12); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fcd34d';
    ctx.font = 'bold 14px Outfit,sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(name, bx + 16, by + 12);
    ctx.fillStyle = '#fff';
    ctx.font = '15px Outfit,sans-serif';
    this._wrapText(text, bx + 16, by + 38, bw - 32, 20);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '11px Outfit,sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('Guzik = dalej ▶', bx + bw - 14, by + bh - 18);
  }

  _wrapText(text, x, y, maxW, lh) {
    const ctx = this.ctx;
    const words = text.split(' ');
    let line = '', yy = y;
    for (const w of words) {
      const test = line + w + ' ';
      if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, yy); line = w + ' '; yy += lh; }
      else line = test;
    }
    ctx.fillText(line, x, yy);
  }

  _drawShop() {
    const { ctx, W, H } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, W, H);
    const bw = Math.min(W - 40, 360), bh = 200;
    const bx = (W - bw) / 2, by = (H - bh) / 2;
    ctx.fillStyle = 'rgba(15,18,30,0.97)';
    ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 14); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#c084fc';
    ctx.font = 'bold 18px Outfit,sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('🧙 Sklep Handlarza', W / 2, by + 14);
    ctx.fillStyle = '#fcd34d';
    ctx.font = '13px Outfit,sans-serif';
    ctx.fillText('💰 ' + this.p.gold + ' złota', W / 2, by + 40);

    const opts = [...SHOP_ITEMS.map(s => `${s.label} — ${s.cost}g`), 'Wyjdź'];
    ctx.font = '14px Outfit,sans-serif';
    ctx.textAlign = 'left';
    opts.forEach((o, i) => {
      const yy = by + 70 + i * 34;
      if (i === this.shop.sel) {
        ctx.fillStyle = 'rgba(168,85,247,0.3)';
        ctx.fillRect(bx + 12, yy - 4, bw - 24, 28);
        ctx.fillStyle = '#fff';
      } else ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText((i === this.shop.sel ? '▶ ' : '   ') + o, bx + 20, yy);
    });
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '11px Outfit,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Przechył = wybór · Guzik = kup · Potrząśnij = wyjdź', W / 2, by + bh - 18);
  }

  _drawSavePrompt() {
    const { ctx, W, H } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fcd34d';
    ctx.font = `800 ${Math.round(Math.min(W / 14, 30))}px Outfit,sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Kontynuować? Kliknij!', W / 2, H / 2 - 16);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '14px Outfit,sans-serif';
    ctx.fillText('Czas: ' + Math.ceil(this.promptT / 1000) + 's (potem nowa gra)', W / 2, H / 2 + 24);
  }

  _drawDeath() {
    const { ctx, W, H } = this;
    ctx.fillStyle = 'rgba(120,0,0,0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${Math.round(Math.min(W / 10, 48))}px Outfit,sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Poległeś...', W / 2, H / 2);
  }

  _drawWin() {
    const { ctx, W, H } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, W, H);
    for (const c of this.confetti) {
      ctx.fillStyle = c.c;
      ctx.fillRect(c.x, c.y, c.s, c.s);
    }
    ctx.fillStyle = '#fcd34d';
    ctx.font = `800 ${Math.round(Math.min(W / 14, 34))}px Outfit,sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = '#fcd34d'; ctx.shadowBlur = 20;
    ctx.fillText('URATOWAŁEŚ KSIĘŻNICZKĘ! 🎉', W / 2, H / 2);
    ctx.shadowBlur = 0;
  }

  destroy() { this.running = false; }
}
