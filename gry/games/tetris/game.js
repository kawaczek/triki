// games/tetris/game.js — Tetris Triki
// Sterowanie:
//   Przechył L/R (GZ): przesuń klockę (latch przy progu 15, reset przy <5)
//   Przechył do przodu (GX > 20): soft drop (szybsze opadanie)
//   Guzik: obróć klockę (wall kick przy kolizji)

import { clamp, drawGrid } from '../../static/gameutils.js';

const COLS = 10;
const ROWS = 20;

// Tetromino shapes [rotations][cells] — standardowe kształty SRS
const PIECES = [
  // I — cyan
  {
    color: '#00f0f0',
    shapes: [
      [[0,1],[1,1],[2,1],[3,1]],
      [[2,0],[2,1],[2,2],[2,3]],
      [[0,2],[1,2],[2,2],[3,2]],
      [[1,0],[1,1],[1,2],[1,3]],
    ],
  },
  // O — yellow
  {
    color: '#f0f000',
    shapes: [
      [[1,0],[2,0],[1,1],[2,1]],
      [[1,0],[2,0],[1,1],[2,1]],
      [[1,0],[2,0],[1,1],[2,1]],
      [[1,0],[2,0],[1,1],[2,1]],
    ],
  },
  // T — purple
  {
    color: '#a000f0',
    shapes: [
      [[1,0],[0,1],[1,1],[2,1]],
      [[1,0],[1,1],[2,1],[1,2]],
      [[0,1],[1,1],[2,1],[1,2]],
      [[1,0],[0,1],[1,1],[1,2]],
    ],
  },
  // S — green
  {
    color: '#00f000',
    shapes: [
      [[1,0],[2,0],[0,1],[1,1]],
      [[1,0],[1,1],[2,1],[2,2]],
      [[1,1],[2,1],[0,2],[1,2]],
      [[0,0],[0,1],[1,1],[1,2]],
    ],
  },
  // Z — red
  {
    color: '#f00000',
    shapes: [
      [[0,0],[1,0],[1,1],[2,1]],
      [[2,0],[1,1],[2,1],[1,2]],
      [[0,1],[1,1],[1,2],[2,2]],
      [[1,0],[0,1],[1,1],[0,2]],
    ],
  },
  // J — blue
  {
    color: '#0000f0',
    shapes: [
      [[0,0],[0,1],[1,1],[2,1]],
      [[1,0],[2,0],[1,1],[1,2]],
      [[0,1],[1,1],[2,1],[2,2]],
      [[1,0],[1,1],[0,2],[1,2]],
    ],
  },
  // L — orange
  {
    color: '#f0a000',
    shapes: [
      [[2,0],[0,1],[1,1],[2,1]],
      [[1,0],[1,1],[1,2],[2,2]],
      [[0,1],[1,1],[2,1],[0,2]],
      [[0,0],[1,0],[1,1],[1,2]],
    ],
  },
];

// Wall kick offsets dla SRS (nie-I klocki): [od_rot][próba] = [dx, dy]
const KICKS = [
  [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],   // 0→1
  [[0,0],[1,0],[1,1],[0,-2],[1,-2]],       // 1→2
  [[0,0],[1,0],[1,-1],[0,2],[1,2]],        // 2→3
  [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],   // 3→0
];
const KICKS_I = [
  [[0,0],[-2,0],[1,0],[-2,1],[1,-2]],
  [[0,0],[-1,0],[2,0],[-1,-2],[2,1]],
  [[0,0],[2,0],[-1,0],[2,-1],[-1,2]],
  [[0,0],[1,0],[-2,0],[1,2],[-2,-1]],
];

function randomPiece() {
  const idx = Math.floor(Math.random() * PIECES.length);
  return { type: idx, rot: 0, x: 3, y: 0 };
}

function cells(piece) {
  return PIECES[piece.type].shapes[piece.rot].map(([cx, cy]) => ({
    x: piece.x + cx,
    y: piece.y + cy,
  }));
}

export default class TetrisGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas  = canvas;
    this.ctx     = ctx;
    this.triki   = triki;
    this.emit    = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;

    // Inicjalizacja całego stanu — drawIdle() może być wywołane przed start()
    this._initState();
  }

  _initState() {
    // Plansza: ROWS × COLS, każda komórka = null | colorString
    this.board = Array.from({length: ROWS}, () => Array(COLS).fill(null));
    this.current  = randomPiece();
    this.next     = randomPiece();
    this.score    = 0;
    this.lines    = 0;
    this.level    = 1;
    this._dropAcc = 0;
    this._tiltLatch = false;   // latch bocznego przechyłu
    this._lastTiltDir = 0;
    this._gameOver = false;
    this._flashLines = [];     // linie do animacji usunięcia
    this._flashTimer = 0;
    this._banner = null;
  }

  // Interwał opadania [ms] — zależy od poziomu
  get _dropInterval() {
    // poziom 1 = 800ms, każdy poziom −60ms, min 80ms
    return Math.max(80, 800 - (this.level - 1) * 60);
  }

  start(player) {
    this.player = player;
    this._initState();
    this.running = true;
    this._emitStats();
  }

  resize(W, H) { this.W = W; this.H = H; }
  destroy()    { this.running = false; }
  drawIdle()   { this.draw(); }

  // ─── update ──────────────────────────────────────────────
  update(dt) {
    if (!this.running) return;

    // Animacja błysku linii
    if (this._flashTimer > 0) {
      this._flashTimer -= dt;
      if (this._flashTimer <= 0) {
        this._clearLines(this._flashLines);
        this._flashLines = [];
      }
      return; // blokuj input podczas animacji
    }

    // Obróć = click
    if (this.triki.consumeClick()) {
      this._rotate();
    }

    // Przesunięcie boczne — latch
    const hz = -this.triki.GZ(0);   // GZ skalibrowany; lewo < 0, prawo > 0
    const TRIG = 15, REL = 5;

    if (Math.abs(hz) >= TRIG) {
      if (!this._tiltLatch) {
        this._tiltLatch = true;
        this._move(hz > 0 ? 1 : -1);
      }
    } else if (Math.abs(hz) < REL) {
      this._tiltLatch = false;
    }

    // Soft drop: przechył do przodu (GX > 20)
    const fwd = this.triki.GX(0);
    const softDrop = fwd > 20;

    // Grawitacja
    const interval = softDrop ? Math.max(50, this._dropInterval / 8) : this._dropInterval;
    this._dropAcc += dt;
    if (this._dropAcc >= interval) {
      this._dropAcc -= interval;
      this._gravity();
    }

    if (this._banner) {
      this._banner.t -= dt;
      if (this._banner.t <= 0) this._banner = null;
    }
  }

  // ─── mechanika ───────────────────────────────────────────
  _move(dx) {
    const p = {...this.current, x: this.current.x + dx};
    if (!this._collides(p)) this.current = p;
  }

  _rotate() {
    const nextRot = (this.current.rot + 1) % 4;
    const p = {...this.current, rot: nextRot};
    const kicks = this.current.type === 0 ? KICKS_I : KICKS;
    const kickSet = kicks[this.current.rot];
    for (const [kx, ky] of kickSet) {
      const kicked = {...p, x: p.x + kx, y: p.y + ky};
      if (!this._collides(kicked)) {
        this.current = kicked;
        return;
      }
    }
    // Nie udało się — nie obracaj
  }

  _gravity() {
    const p = {...this.current, y: this.current.y + 1};
    if (!this._collides(p)) {
      this.current = p;
    } else {
      this._lock();
    }
  }

  _lock() {
    // Wpisz klocek na planszę
    const color = PIECES[this.current.type].color;
    for (const {x, y} of cells(this.current)) {
      if (y < 0) {
        // Game over — klocek nie zmieścił się
        this.running = false;
        this._gameOver = true;
        this.emit('end', {score: this.score});
        return;
      }
      if (y < ROWS && x >= 0 && x < COLS) {
        this.board[y][x] = color;
      }
    }

    // Znajdź pełne linie
    const full = [];
    for (let r = 0; r < ROWS; r++) {
      if (this.board[r].every(c => c !== null)) full.push(r);
    }

    if (full.length > 0) {
      this._flashLines = full;
      this._flashTimer = 200;  // ms animacji
      this._scoreLines(full.length);
    }

    // Spawn nowego klocka
    this.current = this.next;
    this.next    = randomPiece();
    this._dropAcc = 0;
    this._emitStats();
  }

  _scoreLines(n) {
    const pts = [0, 100, 300, 500, 800][n] || 800;
    this.score += pts * this.level;
    this.lines  += n;
    const newLevel = 1 + Math.floor(this.lines / 10);
    if (newLevel > this.level) {
      this.level = newLevel;
      this._banner = {text: `POZIOM ${this.level}!`, t: 1200};
    }
  }

  _clearLines(rows) {
    const rowSet = new Set(rows);
    const kept = this.board.filter((_, r) => !rowSet.has(r));
    while (kept.length < ROWS) kept.unshift(Array(COLS).fill(null));
    this.board = kept;
  }

  _collides(p) {
    for (const {x, y} of cells(p)) {
      if (x < 0 || x >= COLS) return true;
      if (y >= ROWS) return true;
      if (y >= 0 && this.board[y][x] !== null) return true;
    }
    return false;
  }

  // ─── oblicz ghost piece (cień klocka) ────────────────────
  _ghostY() {
    let p = {...this.current};
    while (!this._collides({...p, y: p.y + 1})) p.y++;
    return p.y;
  }

  // ─── draw ────────────────────────────────────────────────
  draw() {
    const {ctx, W, H} = this;
    ctx.clearRect(0, 0, W, H);
    drawGrid(ctx, W, H, 0.025);

    // Layout: plansza gry po lewej, panel podglądu po prawej
    const PREVIEW_W = Math.max(60, Math.min(90, W * 0.22));
    const BOARD_W   = W - PREVIEW_W - 8;
    const BOARD_H   = H;

    const cellW = Math.floor(BOARD_W / COLS);
    const cellH = Math.floor(BOARD_H / ROWS);
    const cell  = Math.min(cellW, cellH);
    const boardX = Math.floor((BOARD_W - cell * COLS) / 2);
    const boardY = Math.floor((BOARD_H - cell * ROWS) / 2);

    // Tło planszy
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.roundRect(boardX - 2, boardY - 2, cell * COLS + 4, cell * ROWS + 4, 6);
    ctx.fill();
    ctx.restore();

    // Ramka planszy
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(boardX - 2, boardY - 2, cell * COLS + 4, cell * ROWS + 4, 6);
    ctx.stroke();
    ctx.restore();

    // Siatka wewnętrzna
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let c = 1; c < COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(boardX + c * cell, boardY);
      ctx.lineTo(boardX + c * cell, boardY + ROWS * cell);
      ctx.stroke();
    }
    for (let r = 1; r < ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(boardX, boardY + r * cell);
      ctx.lineTo(boardX + COLS * cell, boardY + r * cell);
      ctx.stroke();
    }
    ctx.restore();

    // Zagrane komórki
    const flashSet = new Set(this._flashLines);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const color = this.board[r][c];
        if (color) {
          if (flashSet.has(r)) {
            // Efekt błysku — biało-żółty
            const pulse = this._flashTimer / 200;
            ctx.save();
            ctx.fillStyle = `rgba(255,255,${Math.round(200*pulse)},${0.6 + 0.4 * pulse})`;
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur  = 14;
            this._drawCell(ctx, boardX + c * cell, boardY + r * cell, cell, '#ffffff');
            ctx.restore();
          } else {
            this._drawCell(ctx, boardX + c * cell, boardY + r * cell, cell, color);
          }
        }
      }
    }

    // Ghost piece (przezroczysty cień)
    if (!this._gameOver && this._flashTimer <= 0) {
      const ghostY = this._ghostY();
      const ghostColor = PIECES[this.current.type].color;
      ctx.save();
      ctx.globalAlpha = 0.22;
      for (const {x, y} of cells({...this.current, y: ghostY})) {
        if (y >= 0) {
          this._drawCell(ctx, boardX + x * cell, boardY + y * cell, cell, ghostColor);
        }
      }
      ctx.restore();
    }

    // Aktywny klocek
    if (!this._gameOver) {
      const color = PIECES[this.current.type].color;
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur  = 8;
      for (const {x, y} of cells(this.current)) {
        if (y >= 0) {
          this._drawCell(ctx, boardX + x * cell, boardY + y * cell, cell, color);
        }
      }
      ctx.restore();
    }

    // Panel podglądu (prawy)
    this._drawPreview(ctx, W - PREVIEW_W + 4, boardY, PREVIEW_W - 8, cell);

    // Banner poziomu
    if (this._banner) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this._banner.t / 350);
      ctx.fillStyle   = '#22c55e';
      ctx.font = `800 ${Math.round(W / 10)}px Outfit, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = '#22c55e'; ctx.shadowBlur = 24;
      ctx.fillText(this._banner.text, BOARD_W / 2, H / 2.4);
      ctx.restore();
    }
  }

  _drawCell(ctx, x, y, size, color) {
    const pad = Math.max(1, size * 0.07);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x + pad, y + pad, size - 2 * pad, size - 2 * pad, Math.max(2, size * 0.15));
    ctx.fill();
    // Jasna krawędź (highlight)
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = Math.max(1, size * 0.06);
    ctx.beginPath();
    ctx.roundRect(x + pad, y + pad, size - 2 * pad, size - 2 * pad, Math.max(2, size * 0.15));
    ctx.stroke();
    ctx.restore();
  }

  _drawPreview(ctx, px, py, pw, cell) {
    // Nagłówek "NEXT"
    ctx.save();
    ctx.fillStyle   = 'rgba(255,255,255,0.5)';
    ctx.font        = `600 ${Math.max(10, pw * 0.2)}px Outfit, sans-serif`;
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('NEXT', px + pw / 2, py);
    ctx.restore();

    const previewCell = Math.min(cell, Math.floor(pw / 4));
    const previewOffY = py + previewCell * 0.8;
    const previewOffX = px + (pw - previewCell * 4) / 2;

    const nextColor = PIECES[this.next.type].color;
    ctx.save();
    ctx.shadowColor = nextColor;
    ctx.shadowBlur  = 6;
    for (const [cx, cy] of PIECES[this.next.type].shapes[0]) {
      this._drawCell(ctx, previewOffX + cx * previewCell, previewOffY + cy * previewCell, previewCell, nextColor);
    }
    ctx.restore();

    // Wynik i poziom
    const textY = previewOffY + previewCell * 4 + 12;
    ctx.save();
    ctx.fillStyle   = 'rgba(255,255,255,0.55)';
    ctx.font        = `${Math.max(9, pw * 0.18)}px Outfit, sans-serif`;
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('WYNIK', px + pw / 2, textY);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.max(11, pw * 0.24)}px Outfit, sans-serif`;
    ctx.fillText(this.score, px + pw / 2, textY + Math.max(10, pw * 0.2));
    ctx.fillStyle   = 'rgba(255,255,255,0.55)';
    ctx.font        = `${Math.max(9, pw * 0.18)}px Outfit, sans-serif`;
    ctx.fillText(`LVL ${this.level}`, px + pw / 2, textY + Math.max(22, pw * 0.44));
    ctx.fillText(`${this.lines} linii`, px + pw / 2, textY + Math.max(34, pw * 0.64));
    ctx.restore();
  }

  _emitStats() {
    this.emit('stats',
      `🟦 Poz. <b>${this.level}</b> &nbsp;·&nbsp; 📏 <b>${this.lines}</b> linii &nbsp;·&nbsp; ⭐ <b>${this.score}</b> pkt`
    );
  }
}
