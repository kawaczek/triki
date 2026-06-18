// games/bubbles/game.js — Bubble Shooter
// Sterowanie: ROT() kapsla = kąt celowania, klik = strzał.
// Plansza offsetowa (hex uproszczony) 10 kol × 8 rzędów.
// Kolizja bąbelka lecącego → "przyklejenie" → flood-fill usuwanie kolorów → grawitacja wiszątek.

import { clamp, rand, radialGlow } from '../../static/gameutils.js';

const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7'];
const COLS = 10;
const ROWS = 8;
const TWO_PI = Math.PI * 2;

// Promień bąbelka obliczany dynamicznie: bubR = W / (2*COLS + 1)
// Siatka offsetowa: nieparzyste rzędy są przesunięte o bubR w prawo.

function colToColors(grid) {
  // Zwraca listę kolorów obecnych w siatce
  const set = new Set();
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (grid[r][c] !== null) set.add(grid[r][c]);
  return [...set];
}

function getCellPos(row, col, bubR) {
  // Pozycja środka bąbelka (col, row) w pikselach (offsetowa siatka)
  const offsetX = (row % 2 === 1) ? bubR : 0;
  const x = bubR + col * bubR * 2 + offsetX;
  const y = bubR + row * bubR * Math.sqrt(3); // hex pionowy krok
  return { x, y };
}

function getNeighbors(row, col) {
  // 6 sąsiadów w siatce offsetowej
  const even = row % 2 === 0;
  return [
    [row - 1, even ? col - 1 : col],
    [row - 1, even ? col     : col + 1],
    [row,     col - 1],
    [row,     col + 1],
    [row + 1, even ? col - 1 : col],
    [row + 1, even ? col     : col + 1],
  ].filter(([r, c]) => r >= 0 && r < ROWS && c >= 0 && c < COLS);
}

function makeGrid() {
  // Tworzy siatkę ROWS×COLS, 8 rzędów wypełnionych losowymi kolorami
  const grid = [];
  for (let r = 0; r < ROWS; r++) {
    grid.push([]);
    for (let c = 0; c < COLS; c++) {
      grid[r].push(COLORS[Math.floor(Math.random() * COLORS.length)]);
    }
  }
  return grid;
}

// ── Flood-fill: znajduje wszystkie pola danego koloru połączone z (row, col) ──
function floodFill(grid, row, col, color) {
  const visited = new Set();
  const stack = [[row, col]];
  while (stack.length > 0) {
    const [r, c] = stack.pop();
    const key = `${r},${c}`;
    if (visited.has(key)) continue;
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
    if (grid[r][c] !== color) continue;
    visited.add(key);
    for (const nb of getNeighbors(r, c)) stack.push(nb);
  }
  return [...visited].map(k => k.split(',').map(Number));
}

// ── Flood-fill od sufitu: wszystkie bąbelki dostępne z góry ──
function findConnectedToTop(grid) {
  const visited = new Set();
  const stack = [];
  for (let c = 0; c < COLS; c++) {
    if (grid[0][c] !== null) stack.push([0, c]);
  }
  while (stack.length > 0) {
    const [r, c] = stack.pop();
    const key = `${r},${c}`;
    if (visited.has(key)) continue;
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
    if (grid[r][c] === null) continue;
    visited.add(key);
    for (const nb of getNeighbors(r, c)) stack.push(nb);
  }
  return visited;
}

// ── Cząsteczki (pop bąbelka) ─────────────────────────────────

class Particle {
  constructor(x, y, color) {
    this.x = x; this.y = y;
    this.color = color;
    const a = Math.random() * TWO_PI;
    const spd = rand(1.5, 4);
    this.vx = Math.cos(a) * spd;
    this.vy = Math.sin(a) * spd - rand(1, 3);
    this.life = rand(300, 600);
    this.maxLife = this.life;
    this.r = rand(3, 6);
  }
  update(dt) {
    this.x += this.vx * dt / 16;
    this.y += this.vy * dt / 16;
    this.vy += 0.12 * dt / 16; // grawitacja
    this.life -= dt;
  }
  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = clamp(this.life / this.maxLife, 0, 1);
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }
  get alive() { return this.life > 0; }
}

// ── Latający bąbelek (po usunięciu, spada w dół) ─────────────

class FallingBubble {
  constructor(x, y, color) {
    this.x = x; this.y = y;
    this.color = color;
    this.vy = rand(1, 3);
    this.vx = rand(-1.5, 1.5);
    this.life = 800; this.maxLife = 800;
    this.r = 0;
  }
  update(dt, r) {
    this.r = r;
    this.vy += 0.1 * dt / 16;
    this.x += this.vx * dt / 16;
    this.y += this.vy * dt / 16;
    this.life -= dt;
  }
  draw(ctx, r) {
    ctx.save();
    ctx.globalAlpha = clamp(this.life / this.maxLife, 0, 1);
    drawBubble(ctx, this.x, this.y, r, this.color);
    ctx.restore();
  }
  get alive() { return this.life > 0; }
}

// ── Rysowanie bąbelka ────────────────────────────────────────

function drawBubble(ctx, x, y, r, color) {
  // Wypełnienie z radialnym gradientem (połysk)
  const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.05, x, y, r);
  grad.addColorStop(0, lighten(color, 0.55));
  grad.addColorStop(0.7, color);
  grad.addColorStop(1, darken(color, 0.35));
  ctx.beginPath();
  ctx.arc(x, y, r - 1, 0, TWO_PI);
  ctx.fillStyle = grad;
  ctx.fill();
  // Obrys
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Błysk
  ctx.save();
  ctx.beginPath();
  ctx.arc(x - r * 0.28, y - r * 0.28, r * 0.22, 0, TWO_PI);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fill();
  ctx.restore();
}

function lighten(hex, t) {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${Math.round(r + (255 - r) * t)},${Math.round(g + (255 - g) * t)},${Math.round(b + (255 - b) * t)})`;
}
function darken(hex, t) {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${Math.round(r * (1 - t))},${Math.round(g * (1 - t))},${Math.round(b * (1 - t))})`;
}
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ── Gra główna ───────────────────────────────────────────────

export default class BubblesGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.triki = triki;
    this.emit = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;

    // Wymiary siatki — obliczane w resize
    this.bubR = 0;
    this.gridOffY = 0; // Y przesunięcia siatki od góry

    // Stan gry — inicjalizuj wszystko tu
    this.grid = makeGrid();
    this.score = 0;
    this.aimAngle = -Math.PI / 2; // celujemy w górę
    this.shootColor = COLORS[0];
    this.nextColor = COLORS[1];
    this.flying = null; // bąbelek w locie: {x, y, vx, vy, color}
    this.particles = [];
    this.fallingBubbles = [];
    this._gameOver = false;
    this._won = false;
    this._shotCooldown = 0;
    this._combo = 0;

    // Wylicz rozmiary na bieżącym canvasie
    this._calcLayout();
    this._pickNextColors();
  }

  _calcLayout() {
    // bubR tak, żeby 10 bąbelków + marginesy mieściły się szerokością
    this.bubR = Math.floor(this.W / (COLS * 2 + 1));
    // Siatka startuje od Y = bubR
    this.gridOffY = this.bubR;
    // Linia śmierci: gdy bąbelki dotrą do dołu działka
    this.deathLineY = this.H - this.bubR * 4.5;
    // Pozycja działka
    this.cannonY = this.H - this.bubR * 2;
    this.cannonX = this.W / 2;
  }

  _pickNextColors() {
    const present = colToColors(this.grid);
    const pool = present.length > 0 ? present : COLORS;
    this.shootColor = pool[Math.floor(Math.random() * pool.length)];
    this.nextColor  = pool[Math.floor(Math.random() * pool.length)];
  }

  start(player) {
    this.player = player;
    this.grid = makeGrid();
    this.score = 0;
    this.aimAngle = -Math.PI / 2;
    this.flying = null;
    this.particles = [];
    this.fallingBubbles = [];
    this._gameOver = false;
    this._won = false;
    this._shotCooldown = 0;
    this._combo = 0;
    this._calcLayout();
    this._pickNextColors();
    this.running = true;
    this._emitStats();
  }

  resize(W, H) {
    this.W = W; this.H = H;
    this._calcLayout();
  }

  // ── Strzał ────────────────────────────────────────────────

  _shoot() {
    if (this.flying || !this.running || this._gameOver || this._shotCooldown > 0) return;
    const spd = 0.55; // px/ms
    this.flying = {
      x: this.cannonX,
      y: this.cannonY,
      vx: Math.cos(this.aimAngle) * spd,
      vy: Math.sin(this.aimAngle) * spd,
      color: this.shootColor,
    };
    this.shootColor = this.nextColor;
    const present = colToColors(this.grid);
    const pool = present.length > 0 ? present : COLORS;
    this.nextColor = pool[Math.floor(Math.random() * pool.length)];
    this._shotCooldown = 100;
  }

  // ── Wyznacz komórkę siatki dla pozycji x,y ───────────────

  _snapToGrid(x, y) {
    // Szukamy najbliższej wolnej komórki
    let bestR = -1, bestC = -1, bestDist = Infinity;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.grid[r][c] !== null) continue;
        const pos = getCellPos(r, c, this.bubR);
        const dx = x - (pos.x), dy = y - (pos.y + this.gridOffY);
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          bestR = r; bestC = c;
        }
      }
    }
    return { row: bestR, col: bestC };
  }

  // ── Czy bąbelek lotu koliduje z czymś siatki? ────────────

  _checkFlyingCollision(fb) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.grid[r][c] === null) continue;
        const pos = getCellPos(r, c, this.bubR);
        const dx = fb.x - pos.x;
        const dy = fb.y - (pos.y + this.gridOffY);
        if (dx * dx + dy * dy < (this.bubR * 2 - 2) * (this.bubR * 2 - 2)) {
          return true;
        }
      }
    }
    return false;
  }

  // ── Stick: przyklejenie bąbelka do siatki ────────────────

  _stickBubble(fb) {
    const snap = this._snapToGrid(fb.x, fb.y);
    if (snap.row < 0) return; // brak wolnego miejsca
    this.grid[snap.row][snap.col] = fb.color;

    // Flood-fill: szukaj grupy 3+ tego samego koloru
    const group = floodFill(this.grid, snap.row, snap.col, fb.color);
    if (group.length >= 3) {
      // Usuń grupę
      for (const [r, c] of group) {
        const pos = getCellPos(r, c, this.bubR);
        for (let i = 0; i < 5; i++) {
          this.particles.push(new Particle(pos.x, pos.y + this.gridOffY, this.grid[r][c]));
        }
        this.grid[r][c] = null;
      }
      this.score += group.length * 10;
      this._combo++;

      // Teraz usuń "wiszące" — niepołączone z sufitem
      const connected = findConnectedToTop(this.grid);
      const dangling = [];
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (this.grid[r][c] !== null && !connected.has(`${r},${c}`)) {
            dangling.push([r, c]);
          }
        }
      }
      for (const [r, c] of dangling) {
        const pos = getCellPos(r, c, this.bubR);
        this.fallingBubbles.push(new FallingBubble(pos.x, pos.y + this.gridOffY, this.grid[r][c]));
        this.grid[r][c] = null;
      }
      if (dangling.length > 0) {
        this.score += dangling.length * 15; // bonus za wiszące
      }
      this._emitStats();
    } else {
      this._combo = 0;
    }

    // Sprawdź wygraną: cała siatka pusta
    let anyBubble = false;
    for (let r = 0; r < ROWS && !anyBubble; r++)
      for (let c = 0; c < COLS && !anyBubble; c++)
        if (this.grid[r][c] !== null) anyBubble = true;

    if (!anyBubble) {
      this._won = true;
      this._gameOver = true;
      this.running = false;
      this.emit('end', { score: this.score, won: true });
      return;
    }

    // Sprawdź game over: bąbelek w rzędzie przekraczającym linię śmierci
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.grid[r][c] !== null) {
          const pos = getCellPos(r, c, this.bubR);
          if (pos.y + this.gridOffY + this.bubR > this.deathLineY) {
            this._gameOver = true;
            this.running = false;
            this.emit('end', { score: this.score, won: false });
            return;
          }
        }
      }
    }

    // Zaktualizuj kolory następnego strzału (tylko z puli na planszy)
    const present = colToColors(this.grid);
    if (present.length > 0 && !present.includes(this.nextColor)) {
      this.nextColor = present[Math.floor(Math.random() * present.length)];
    }
  }

  // ── Update ───────────────────────────────────────────────

  update(dt) {
    if (!this.running) return;
    if (this._gameOver) return;

    // Cooldown
    if (this._shotCooldown > 0) this._shotCooldown -= dt;

    // Sterowanie BLE
    if (this.triki.connected) {
      this.aimAngle += this.triki.ROT() * 0.002 * dt;
      if (this.triki.consumeClick()) this._shoot();
    }

    // Ogranicz kąt: [-70°, 70°] od pionu (czyli od -π/2)
    const minA = -Math.PI / 2 - (70 * Math.PI / 180);
    const maxA = -Math.PI / 2 + (70 * Math.PI / 180);
    this.aimAngle = clamp(this.aimAngle, minA, maxA);

    // Bąbelek lecący
    if (this.flying) {
      const fb = this.flying;
      fb.x += fb.vx * dt;
      fb.y += fb.vy * dt;

      // Odbicie od lewej/prawej ściany
      if (fb.x - this.bubR < 0) {
        fb.x = this.bubR;
        fb.vx = Math.abs(fb.vx);
      }
      if (fb.x + this.bubR > this.W) {
        fb.x = this.W - this.bubR;
        fb.vx = -Math.abs(fb.vx);
      }

      // Dotknął sufitu — przyklejamy do pierwszego wolnego rzędu
      if (fb.y - this.bubR <= this.gridOffY) {
        fb.y = this.gridOffY + this.bubR;
        this._stickBubble(fb);
        this.flying = null;
      } else if (this._checkFlyingCollision(fb)) {
        this._stickBubble(fb);
        this.flying = null;
      }
    }

    // Cząsteczki
    this.particles.forEach(p => p.update(dt));
    this.particles = this.particles.filter(p => p.alive);

    // Spadające bąbelki
    this.fallingBubbles.forEach(f => f.update(dt, this.bubR));
    this.fallingBubbles = this.fallingBubbles.filter(f => f.alive);
  }

  // ── Draw ─────────────────────────────────────────────────

  draw() {
    const { ctx, W, H, bubR } = this;
    ctx.clearRect(0, 0, W, H);

    // Tło
    ctx.fillStyle = '#0a0c16';
    ctx.fillRect(0, 0, W, H);

    // Linia śmierci (subtelna)
    ctx.save();
    ctx.strokeStyle = 'rgba(239,68,68,0.25)';
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, this.deathLineY);
    ctx.lineTo(W, this.deathLineY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Bąbelki siatki
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const color = this.grid[r][c];
        if (color === null) continue;
        const pos = getCellPos(r, c, bubR);
        drawBubble(ctx, pos.x, pos.y + this.gridOffY, bubR - 1, color);
      }
    }

    // Spadające bąbelki
    this.fallingBubbles.forEach(f => f.draw(ctx, bubR - 1));

    // Cząsteczki
    this.particles.forEach(p => p.draw(ctx));

    // Linia celowania (przerywana)
    this._drawAimLine(ctx);

    // Bąbelek lecący
    if (this.flying) {
      drawBubble(ctx, this.flying.x, this.flying.y, bubR - 1, this.flying.color);
    }

    // Działko
    this._drawCannon(ctx);
  }

  _drawAimLine(ctx) {
    if (!this.running) return;
    ctx.save();
    ctx.setLineDash([8, 10]);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(this.cannonX, this.cannonY);
    // Symulujemy odbicia linii celowania
    let x = this.cannonX, y = this.cannonY;
    let dx = Math.cos(this.aimAngle), dy = Math.sin(this.aimAngle);
    const len = 18; // liczba kroków
    const step = this.bubR * 2;
    for (let i = 0; i < len; i++) {
      x += dx * step; y += dy * step;
      if (x - this.bubR < 0) { x = this.bubR; dx = Math.abs(dx); }
      if (x + this.bubR > this.W) { x = this.W - this.bubR; dx = -Math.abs(dx); }
      if (y < this.gridOffY + this.bubR) break;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  _drawCannon(ctx) {
    const { cannonX, cannonY, bubR, shootColor, nextColor } = this;

    // Aktualny kolor — koło
    drawBubble(ctx, cannonX, cannonY, bubR - 1, shootColor);

    // Lufa działka
    ctx.save();
    ctx.translate(cannonX, cannonY);
    ctx.rotate(this.aimAngle + Math.PI / 2);
    ctx.fillStyle = 'rgba(100,120,160,0.8)';
    ctx.strokeStyle = 'rgba(200,220,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(-5, -bubR * 1.4, 10, bubR * 1.1);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Następny kolor (mały, w lewym dolnym rogu)
    const nx = bubR * 1.6, ny = this.H - bubR * 1.1;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = `${Math.round(bubR * 0.65)}px Outfit,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NEXT', nx, ny - bubR * 0.9);
    ctx.restore();
    drawBubble(ctx, nx, ny, bubR * 0.72, nextColor);

    // Wynik w górnym prawym rogu
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `bold ${Math.round(bubR * 1.1)}px Outfit,sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.shadowColor = '#a855f7';
    ctx.shadowBlur = 8;
    ctx.fillText(`${this.score}`, this.W - 10, 10);
    ctx.restore();
  }

  drawIdle() {
    // Pokaż siatkę i działko bez aktywnej gry
    this.draw();
  }

  destroy() { this.running = false; }

  _emitStats() {
    this.emit('stats',
      `🎯 Combo: <b>${this._combo}</b> &nbsp;·&nbsp; 🏆 <b>${this.score}</b> pkt`);
  }
}
