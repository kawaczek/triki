import { clamp, rand, radialGlow, drawHintBubble } from '../../static/gameutils.js';

const GAME_MS      = 30_000;
const COLS         = 3;
const ROWS         = 3;
const MAX_MOLES    = 3;
const SPAWN_INT    = 800;
const HIT_PTS      = 10;
const MISS_PTS     = -2;
const MISS_LIFE    = -1;
const START_LIVES  = 5;
const BASE_LIFE_LO = 1200;
const BASE_LIFE_HI = 2000;
const MIN_LIFE     = 600;

function moleLife(elapsed) {
  const diff = Math.min(1, elapsed / GAME_MS);
  const lo = BASE_LIFE_LO * (1 - 0.5 * diff);
  const hi = BASE_LIFE_HI * (1 - 0.5 * diff);
  return Math.max(MIN_LIFE, rand(lo, hi));
}

export default class KretGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas  = canvas;
    this.ctx     = ctx;
    this.triki   = triki;
    this.emit    = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;

    this.cx = 0.5;
    this.cy = 0.5;
    this._mx = 0.5;
    this._my = 0.5;

    this.score     = 0;
    this.lives     = START_LIVES;
    this.timeLeft  = GAME_MS;
    this.elapsed   = 0;
    this.moles     = [];
    this._spawnAcc = 0;

    this._hitFlashes = [];
  }

  start(player) {
    this.player    = player;
    this.score     = 0;
    this.lives     = START_LIVES;
    this.timeLeft  = GAME_MS;
    this.elapsed   = 0;
    this.moles     = [];
    this._spawnAcc = 0;
    this._hitFlashes = [];
    this.cx        = 0.5;
    this.cy        = 0.5;
    this._mx       = 0.5;
    this._my       = 0.5;
    this.running   = true;
    this._emitStats();
  }

  resize(W, H) { this.W = W; this.H = H; }

  onMouseMove(nx, ny) { this._mx = nx; this._my = ny; }
  onClick() { this._strike(); }
  onKeyDown(code) { if (code === 'Space' || code === 'Enter') this._strike(); }

  update(dt) {
    if (!this.running) return;

    this.timeLeft -= dt;
    this.elapsed  += dt;

    if (this.timeLeft <= 0 || this.lives <= 0) {
      this.timeLeft = Math.max(0, this.timeLeft);
      this.running  = false;
      this.emit('end', { score: Math.max(0, this.score) });
      return;
    }

    if (this.triki.connected) {
      this.cx = clamp(this.cx + (-this.triki.GZ()) * 0.003 * dt, 0, 1);
      this.cy = clamp(this.cy +   this.triki.GX()  * 0.003 * dt, 0, 1);
    } else {
      this.cx += (this._mx - this.cx) * 0.2;
      this.cy += (this._my - this.cy) * 0.2;
    }

    if (this.triki.consumeClick()) this._strike();

    this._spawnAcc += dt;
    if (this._spawnAcc >= SPAWN_INT) {
      this._spawnAcc -= SPAWN_INT;
      this._trySpawn();
    }

    const expired = [];
    this.moles.forEach(m => {
      m.life -= dt;
      if (m.life <= 0) expired.push(m);
    });
    expired.forEach(m => {
      this.moles = this.moles.filter(x => x !== m);
      this.lives -= 1;
      this._emitStats();
    });

    this._hitFlashes = this._hitFlashes.filter(f => {
      f.t -= dt;
      return f.t > 0;
    });
  }

  _trySpawn() {
    if (this.moles.length >= MAX_MOLES) return;
    const occupied = new Set(this.moles.map(m => m.holeIdx));
    const free = [];
    for (let i = 0; i < COLS * ROWS; i++) {
      if (!occupied.has(i)) free.push(i);
    }
    if (free.length === 0) return;
    const idx = free[Math.floor(Math.random() * free.length)];
    const life = moleLife(this.elapsed);
    this.moles.push({ holeIdx: idx, life, maxLife: life });
  }

  _holePos(idx) {
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    const marginX = 0.12;
    const marginY = 0.14;
    const stepX = (1 - 2 * marginX) / (COLS - 1);
    const stepY = (1 - 2 * marginY) / (ROWS - 1);
    return {
      nx: marginX + col * stepX,
      ny: marginY + row * stepY,
    };
  }

  _strike() {
    if (!this.running) return;
    const px = this.cx * this.W;
    const py = this.cy * this.H;
    const holeR = this._holeRadius();
    let hit = false;
    this.moles = this.moles.filter(m => {
      const { nx, ny } = this._holePos(m.holeIdx);
      const hx = nx * this.W;
      const hy = ny * this.H;
      const dx = px - hx, dy = py - hy;
      if (dx*dx + dy*dy < (holeR * 1.4) * (holeR * 1.4)) {
        this.score += HIT_PTS;
        this._hitFlashes.push({ x: hx, y: hy, t: 350, maxT: 350, color: '#a855f7' });
        hit = true;
        return false;
      }
      return true;
    });
    if (!hit) {
      this.score = Math.max(0, this.score + MISS_PTS);
      this._hitFlashes.push({ x: px, y: py, t: 280, maxT: 280, color: '#ef4444' });
    }
    this._emitStats();
  }

  _holeRadius() {
    const cellW = this.W / (COLS + 1);
    const cellH = this.H / (ROWS + 1);
    return Math.min(cellW, cellH) * 0.38;
  }

  draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    this._drawGrass();

    for (let i = 0; i < COLS * ROWS; i++) {
      this._drawHole(i);
    }

    this.moles.forEach(m => this._drawMole(m));

    this._hitFlashes.forEach(f => {
      const alpha = f.t / f.maxT;
      radialGlow(ctx, f.x, f.y, 60, f.color, alpha * 0.7);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = f.color;
      ctx.font = `bold ${Math.round(W * 0.06)}px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(f.color === '#ef4444' ? 'pudło!' : '+10', f.x, f.y - 20);
      ctx.restore();
    });

    this._drawCursor();

    this._drawHUD();
  }

  _drawGrass() {
    const { ctx, W, H } = this;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#15803d');
    g.addColorStop(1, '#166534');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 18) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += 18) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.restore();
  }

  _drawHole(idx) {
    const { ctx, W, H } = this;
    const { nx, ny } = this._holePos(idx);
    const x = nx * W;
    const y = ny * H;
    const r = this._holeRadius();

    const shadow = ctx.createRadialGradient(x, y + r * 0.3, r * 0.1, x, y, r);
    shadow.addColorStop(0, '#3b1f0a');
    shadow.addColorStop(0.6, '#5c2f10');
    shadow.addColorStop(1, '#78401a');

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fillStyle = shadow;
    ctx.fill();
    ctx.strokeStyle = '#2d1206';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  _drawMole(m) {
    const { ctx, W, H } = this;
    const { nx, ny } = this._holePos(m.holeIdx);
    const x = nx * W;
    const y = ny * H;
    const r = this._holeRadius();
    const progress = m.life / m.maxLife;
    const popFrac = progress > 0.85
      ? (1 - progress) / 0.15
      : (progress < 0.15 ? progress / 0.15 : 1);
    const bobOffset = Math.sin(Date.now() / 250) * r * 0.06;
    const moleR = r * 0.82 * popFrac;
    const cy = y - moleR * 0.5 * popFrac + bobOffset;

    if (moleR < 2) return;

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.95, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#3b1f0a';
    ctx.fill();
    ctx.restore();

    radialGlow(ctx, x, cy, moleR * 2, '#a855f7', 0.25 * popFrac);

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, cy, moleR, 0, Math.PI * 2);
    const bodyGrad = ctx.createRadialGradient(x - moleR * 0.25, cy - moleR * 0.2, moleR * 0.1, x, cy, moleR);
    bodyGrad.addColorStop(0, '#c47c3a');
    bodyGrad.addColorStop(1, '#8b4513');
    ctx.fillStyle = bodyGrad;
    ctx.fill();
    ctx.restore();

    const snoutR = moleR * 0.32;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, cy + moleR * 0.22, snoutR, snoutR * 0.7, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#d4956a';
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = '#1a0800';
    ctx.beginPath();
    ctx.arc(x - snoutR * 0.38, cy + moleR * 0.16, snoutR * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + snoutR * 0.38, cy + moleR * 0.16, snoutR * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const eyeR = moleR * 0.13;
    const eyeY = cy - moleR * 0.12;
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x - moleR * 0.28, eyeY, eyeR * 1.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + moleR * 0.28, eyeY, eyeR * 1.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(x - moleR * 0.28, eyeY, eyeR, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + moleR * 0.28, eyeY, eyeR, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    const whiskerLen = moleR * 0.55;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    [[-1, -0.15], [-1, 0.05], [1, -0.15], [1, 0.05]].forEach(([side, angle]) => {
      const wx = x + side * snoutR * 0.9;
      const wy = cy + moleR * 0.22 + moleR * 0.05;
      ctx.beginPath();
      ctx.moveTo(wx, wy);
      ctx.lineTo(wx + side * whiskerLen, wy + angle * moleR);
      ctx.stroke();
    });
    ctx.restore();

    const timerFrac = 1 - progress;
    const barW = moleR * 2;
    const barH = 5;
    const barX = x - moleR;
    const barY = cy - moleR - 10;
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, 2);
    ctx.fill();
    const barColor = timerFrac < 0.3 ? '#ef4444' : timerFrac < 0.6 ? '#f59e0b' : '#22c55e';
    ctx.fillStyle = barColor;
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW * (1 - timerFrac), barH, 2);
    ctx.fill();
    ctx.restore();
  }

  _drawCursor() {
    const { ctx, W, H } = this;
    const x = this.cx * W;
    const y = this.cy * H;
    const r = 18;

    radialGlow(ctx, x, y, r * 3, '#a855f7', 0.3);

    ctx.save();
    ctx.strokeStyle = '#e879f9';
    ctx.lineWidth   = 2.5;
    ctx.shadowColor = '#a855f7';
    ctx.shadowBlur  = 10;

    ctx.beginPath();
    ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
    ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
    ctx.strokeStyle = '#f0abfc';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
  }

  _drawHUD() {
    const { ctx, W, H } = this;
    const pad = 10;
    const barH = 28;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.roundRect(pad, pad, W - 2 * pad, barH, 6);
    ctx.fill();

    const secs = Math.ceil(this.timeLeft / 1000);
    const timerColor = secs <= 5 ? '#ef4444' : '#fff';
    ctx.fillStyle = timerColor;
    ctx.font = `bold ${Math.round(barH * 0.65)}px Outfit, monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`⏱ ${secs}s`, pad + 8, pad + barH / 2);

    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(`⭐ ${this.score} pkt`, W / 2, pad + barH / 2);

    ctx.textAlign = 'right';
    const heartsText = '❤️'.repeat(Math.max(0, this.lives));
    ctx.fillText(heartsText || '💀', W - pad - 8, pad + barH / 2);

    ctx.restore();
  }

  drawIdle() {
    this.draw();
    const { ctx, W, H } = this;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, H);
    drawHintBubble(ctx, W / 2, H / 2, 'Przechyl kapsla i kliknij w kreta!', {
      fontSize: 15,
      bg: 'rgba(88,28,135,0.85)',
      border: '#a855f7',
      color: '#f0abfc',
    });
    ctx.restore();
  }

  destroy() { this.running = false; }

  _emitStats() {
    const secs = Math.ceil(this.timeLeft / 1000);
    const hearts = '❤️'.repeat(Math.max(0, this.lives));
    this.emit('stats', `⭐ <b>${this.score}</b> pkt &nbsp;·&nbsp; ${hearts} &nbsp;·&nbsp; ⏱ ${secs}s`);
  }
}
