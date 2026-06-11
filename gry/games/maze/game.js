// games/maze/game.js — Labirynt Kulka
// Przechylaj kapsel, żeby toczyć kulkę przez labirynt do wyjścia.
// Omijaj dziury! 5 plansz o rosnącej trudności, 3 życia na całą grę.
// Legenda plansz: # ściana, . podłoga, S start, E wyjście, O dziura

import { clamp, lerp, radialGlow } from '../../static/gameutils.js';

const LEVELS = [
  [ // Plansza 1 — serpentyna bez dziur (rozgrzewka)
    '#########',
    '#S......#',
    '#######.#',
    '#.......#',
    '#.#######',
    '#.......#',
    '#######.#',
    '#.......#',
    '#.#######',
    '#.......#',
    '#######.#',
    '#......E#',
    '#########',
  ],
  [ // Plansza 2 — serpentyna 2-rzędowa z dziurami
    '#########',
    '#S......#',
    '#....O..#',
    '#######.#',
    '#..O....#',
    '#.......#',
    '#.#######',
    '#.....O.#',
    '#.......#',
    '#######.#',
    '#...O...#',
    '#......E#',
    '#########',
  ],
  [ // Plansza 3 — więcej dziur, slalom w pasmach
    '#########',
    '#S......#',
    '#.....O.#',
    '#######.#',
    '#.O.....#',
    '#....O..#',
    '#.#######',
    '#..O..O.#',
    '#.......#',
    '#######.#',
    '#..O..O.#',
    '#......E#',
    '#########',
  ],
  [ // Plansza 4 — ciasne tkanie między dziurami
    '#########',
    '#S......#',
    '#.....O.#',
    '#######.#',
    '#.....O.#',
    '#.O.....#',
    '#.#######',
    '#.O...O.#',
    '#...O...#',
    '#######.#',
    '#.O..O..#',
    '#...O..E#',
    '#########',
  ],
  [ // Plansza 5 — arena: slalom przez pole dziur
    '#########',
    '#S......#',
    '#.O.O.O.#',
    '#...O...#',
    '#O.....O#',
    '#...O...#',
    '#.O...O.#',
    '#...O...#',
    '#O.....O#',
    '#...O...#',
    '#.O.O.O.#',
    '#......E#',
    '#########',
  ],
];

const ACC      = 0.000045; // przyspieszenie na jednostkę przechyłu (px/ms²)
const DAMP     = 0.995;    // tarcie na ms
const MAX_V    = 0.55;     // maks. prędkość px/ms
const LIVES    = 3;

export default class MazeGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas;
    this.ctx    = ctx;
    this.triki  = triki;
    this.emit   = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;
    this._mx = 0.5; this._my = 0.5;
    this._keys = {};

    this.levelIdx = 0;
    this.lives = LIVES;
    this.score = 0;
    this._banner = null;
    this._falling = 0;   // animacja wpadania w dziurę
    this._loadLevel(0);
  }

  _grid() { return LEVELS[this.levelIdx]; }

  _layout() {
    const rows = this._grid().length;
    const cols = this._grid()[0].length;
    const cell = Math.min(this.W / cols, this.H / rows);
    const ox = (this.W - cols * cell) / 2;
    const oy = (this.H - rows * cell) / 2;
    return { rows, cols, cell, ox, oy };
  }

  _loadLevel(idx) {
    this.levelIdx = idx;
    const g = this._grid();
    this.holes = [];
    for (let y = 0; y < g.length; y++) {
      for (let x = 0; x < g[y].length; x++) {
        const c = g[y][x];
        if (c === 'S') this.startCell = {x, y};
        if (c === 'E') this.exitCell  = {x, y};
        if (c === 'O') this.holes.push({x, y});
      }
    }
    this._resetBall();
    this._levelT = 0;
  }

  _resetBall() {
    const { cell, ox, oy } = this._layout();
    this.bx = ox + (this.startCell.x + 0.5) * cell;
    this.by = oy + (this.startCell.y + 0.5) * cell;
    this.vx = 0; this.vy = 0;
    this._falling = 0;
  }

  start(player) {
    this.player = player;
    this.lives = LIVES;
    this.score = 0;
    this._banner = {text: 'PLANSZA 1', t: 1300};
    this._loadLevel(0);
    this.running = true;
    this._emitStats();
  }

  resize(W, H) {
    this.W = W; this.H = H;
    this._resetBall(); // układ planszy się przesuwa — wróć na start
  }

  onMouseMove(nx, ny) { this._mx = nx; this._my = ny; }
  onClick() {}
  onKeyDown(code) { this._keys[code] = true; }
  onKeyUp(code)   { this._keys[code] = false; }

  // wejście w "jednostkach przechyłu" (±15)
  _input() {
    if (this.triki.connected) {
      return { h: -this.triki.GZ(), v: this.triki.GX() };
    }
    let h = 0, v = 0;
    if (this._keys.ArrowLeft  || this._keys.KeyA) h -= 12;
    if (this._keys.ArrowRight || this._keys.KeyD) h += 12;
    if (this._keys.ArrowUp    || this._keys.KeyW) v -= 12;
    if (this._keys.ArrowDown  || this._keys.KeyS) v += 12;
    if (h || v) return { h, v };
    // mysz/palec: kulka przyspiesza w stronę kursora
    const tx = this._mx * this.W, ty = this._my * this.H;
    return {
      h: clamp((tx - this.bx) / 60, -1, 1) * 12,
      v: clamp((ty - this.by) / 60, -1, 1) * 12,
    };
  }

  _isWall(cx, cy) {
    const g = this._grid();
    if (cy < 0 || cy >= g.length || cx < 0 || cx >= g[0].length) return true;
    return g[cy][cx] === '#';
  }

  _collides(x, y, r) {
    const { cell, ox, oy } = this._layout();
    const minX = Math.floor((x - r - ox) / cell);
    const maxX = Math.floor((x + r - ox) / cell);
    const minY = Math.floor((y - r - oy) / cell);
    const maxY = Math.floor((y + r - oy) / cell);
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        if (!this._isWall(cx, cy)) continue;
        const nx = Math.max(ox + cx*cell, Math.min(x, ox + (cx+1)*cell));
        const ny = Math.max(oy + cy*cell, Math.min(y, oy + (cy+1)*cell));
        if ((x-nx)*(x-nx) + (y-ny)*(y-ny) < r*r) return true;
      }
    }
    return false;
  }

  update(dt) {
    if (!this.running) return;
    this._levelT += dt;
    if (this._banner) { this._banner.t -= dt; if (this._banner.t <= 0) this._banner = null; }

    const { cell, ox, oy } = this._layout();
    const r = cell * 0.3;

    // animacja wpadania w dziurę
    if (this._falling > 0) {
      this._falling -= dt;
      if (this._falling <= 0) {
        this.lives--;
        this._emitStats();
        if (this.lives <= 0) {
          this.running = false;
          this.emit('end', { score: this.score });
          return;
        }
        this._resetBall();
      }
      return;
    }

    // fizyka
    const inp = this._input();
    this.vx += inp.h * ACC * dt;
    this.vy += inp.v * ACC * dt;
    const damp = Math.pow(DAMP, dt);
    this.vx = clamp(this.vx * damp, -MAX_V, MAX_V);
    this.vy = clamp(this.vy * damp, -MAX_V, MAX_V);

    // ruch z kolizjami (oś X, potem Y — ślizganie po ścianach)
    const oldX = this.bx;
    this.bx += this.vx * dt;
    if (this._collides(this.bx, this.by, r)) { this.bx = oldX; this.vx *= -0.25; }
    const oldY = this.by;
    this.by += this.vy * dt;
    if (this._collides(this.bx, this.by, r)) { this.by = oldY; this.vy *= -0.25; }

    // dziury
    for (const h of this.holes) {
      const hx = ox + (h.x + 0.5) * cell, hy = oy + (h.y + 0.5) * cell;
      const d = Math.hypot(this.bx - hx, this.by - hy);
      if (d < cell * 0.4) {
        this._falling = 420;
        this._fallHole = {x: hx, y: hy};
        return;
      }
    }

    // wyjście
    const ex = ox + (this.exitCell.x + 0.5) * cell, ey = oy + (this.exitCell.y + 0.5) * cell;
    if (Math.hypot(this.bx - ex, this.by - ey) < cell * 0.45) {
      const bonus = Math.max(0, 40 - Math.floor(this._levelT / 1000)) * 3;
      this.score += 100 + bonus;
      if (this.levelIdx + 1 < LEVELS.length) {
        this._loadLevel(this.levelIdx + 1);
        this._banner = {text: `PLANSZA ${this.levelIdx + 1}`, t: 1300};
        this._emitStats();
      } else {
        this.score += 250; // bonus za ukończenie wszystkich plansz
        this.running = false;
        this.emit('end', { score: this.score, won: true });
        return;
      }
    }

    this._emitStats();
  }

  draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);
    const { rows, cols, cell, ox, oy } = this._layout();
    const g = this._grid();

    // podłoga
    ctx.fillStyle = '#141929';
    ctx.fillRect(ox, oy, cols * cell, rows * cell);

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const tx = ox + x * cell, ty = oy + y * cell;
        const c = g[y][x];
        if (c === '#') {
          ctx.fillStyle = '#334155';
          ctx.fillRect(tx, ty, cell + 0.5, cell + 0.5);
          ctx.fillStyle = '#46587a';
          ctx.fillRect(tx, ty, cell + 0.5, cell * 0.18);
        } else if (c === 'O') {
          ctx.save();
          ctx.fillStyle = '#05070d';
          ctx.beginPath();
          ctx.arc(tx + cell/2, ty + cell/2, cell * 0.38, 0, Math.PI*2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.12)';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        } else if (c === 'E') {
          radialGlow(ctx, tx + cell/2, ty + cell/2, cell * 0.9, '#22c55e', 0.35);
          ctx.fillStyle = '#16a34a';
          ctx.beginPath();
          ctx.arc(tx + cell/2, ty + cell/2, cell * 0.32, 0, Math.PI*2);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = `${cell*0.45}px Outfit, sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('🏁', tx + cell/2, ty + cell/2);
        }
      }
    }

    // kulka (z animacją wpadania)
    const r = cell * 0.3;
    let drawR = r, bx = this.bx, by = this.by;
    if (this._falling > 0) {
      const t = this._falling / 420; // 1 → 0
      drawR = r * t;
      bx = lerp(this._fallHole.x, this.bx, t);
      by = lerp(this._fallHole.y, this.by, t);
    }
    radialGlow(ctx, bx, by, r * 2.2, '#f59e0b', 0.4);
    const grad = ctx.createRadialGradient(bx - drawR*0.35, by - drawR*0.35, drawR*0.1, bx, by, drawR);
    grad.addColorStop(0, '#fcd34d');
    grad.addColorStop(1, '#d97706');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(bx, by, drawR, 0, Math.PI*2);
    ctx.fill();

    // banner
    if (this._banner) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this._banner.t / 350);
      ctx.fillStyle = '#f59e0b';
      ctx.font = `800 ${Math.round(W/9)}px Outfit, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = '#f59e0b'; ctx.shadowBlur = 22;
      ctx.fillText(this._banner.text, W/2, H/2.4);
      ctx.restore();
    }
  }

  drawIdle() { this.draw(); }
  destroy()  { this.running = false; }

  _emitStats() {
    let hearts = '';
    for (let i = 0; i < LIVES; i++) hearts += i < this.lives ? '❤️' : '🖤';
    this.emit('stats',
      `<span style="color:#ef4444">${hearts}</span> &nbsp;·&nbsp; ` +
      `🌀 Plansza <b>${this.levelIdx + 1}/${LEVELS.length}</b> &nbsp;·&nbsp; ` +
      `🏆 <b>${this.score}</b>`);
  }
}
