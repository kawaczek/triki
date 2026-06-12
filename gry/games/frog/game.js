// games/frog/game.js — Żabka łapie muchy
// Poziomy: złap wymaganą liczbę much, by przejść dalej (+ bonus czasu).
// Od poziomu 2 latają osy 🐝 — trafienie osy językiem to -2 punkty!

import { clamp, rand, drawGrid } from '../../static/gameutils.js';

const START_MS   = 25_000;
const LEVEL_BONUS_MS = 9_000;  // dodatkowy czas za przejście poziomu
const FROG_R     = 22;
const FLY_R      = 14;
const TONGUE_SPD = 0.005;    // fraction of H per ms
const SENS_GZ    = 0.001 / 33;
const SENS_GX    = 0.001 / 33;
const SPAWN_INT  = 900;
const FLY_SPEED  = 0.00022;  // fraction per ms
const WASP_CHANCE = 0.25;    // szansa, że spawn to osa (od poziomu 2)

export default class FrogGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas  = canvas;
    this.ctx     = ctx;
    this.triki   = triki;
    this.emit    = emit;
    this.running = false;
    this.W = canvas.width; this.H = canvas.height;
    this._mx = 0.5; this._my = 0.5;
    // stan domyślny — drawIdle() może być wywołane przed start()
    this.frogX = 0.5; this.frogY = 0.5;
    this.score = 0;
    this.level = 1;
    this.levelFlies = 0;
    this.timeLeft = START_MS;
    this.flies = [];
    this.tongue = null;
    this._banner = null;   // {text, t} — napis POZIOM X!
    this._hurtT = 0;       // czerwony błysk po ukąszeniu osy
  }

  // ile much trzeba złapać, by przejść poziom
  get levelTarget() { return 4 + this.level; }
  get speedMult()   { return 1 + (this.level - 1) * 0.18; }

  start(player) {
    this.player    = player;
    this.frogX     = 0.5; this.frogY = 0.5;
    this._mx       = 0.5; this._my   = 0.5;
    this.score     = 0;
    this.level     = 1;
    this.levelFlies= 0;
    this.timeLeft  = START_MS;
    this.flies     = [];
    this._spawnAcc = 0;
    this.tongue    = null;
    this._banner   = { text: 'POZIOM 1', t: 1400 };
    this._hurtT    = 0;
    this.running   = true;
    this._spawn();
  }

  resize(W, H) { this.W = W; this.H = H; }

  onMouseMove(nx, ny) { this._mx = nx; this._my = ny; }

  onClick(nx, ny) {
    if (!this.running || this.tongue) return;
    const tx = this.triki.connected ? this.frogX : nx;
    const ty = this.triki.connected ? this.frogY - 0.15 : ny;
    this._shoot(tx, ty);
  }

  onKeyDown() {}

  update(dt) {
    if (!this.running) return;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.running  = false;
      this.emit('end', { score: this.score });
      return;
    }
    if (this._banner) { this._banner.t -= dt; if (this._banner.t <= 0) this._banner = null; }
    if (this._hurtT > 0) this._hurtT -= dt;

    // move frog
    if (this.triki.connected) {
      this.frogX -= this.triki.GZ() * SENS_GZ * dt;
      this.frogY += this.triki.GX() * SENS_GX * dt;
      if (this.triki.consumeClick() && !this.tongue) {
        this._shoot(this.frogX, this.frogY - 0.15);
      }
    } else {
      this.frogX = this.frogX + (this._mx - this.frogX) * 0.15;
      this.frogY = this.frogY + (this._my - this.frogY) * 0.15;
    }
    this.frogX = clamp(this.frogX, 0.04, 0.96);
    this.frogY = clamp(this.frogY, 0.06, 0.94);

    // flies move
    this._spawnAcc += dt;
    if (this._spawnAcc >= SPAWN_INT) { this._spawnAcc -= SPAWN_INT; this._spawn(); }
    this.flies.forEach(f => {
      f.x += f.vx * dt; f.y += f.vy * dt;
      if (f.x < 0.03 || f.x > 0.97) f.vx *= -1;
      if (f.y < 0.03 || f.y > 0.97) f.vy *= -1;
      f.wingPhase = (f.wingPhase + dt * 0.025) % (Math.PI * 2);
    });

    // tongue
    if (this.tongue) {
      const t = this.tongue;
      if (!t.retracting) {
        t.ext = Math.min(t.ext + TONGUE_SPD * dt, t.maxExt);
        if (t.ext >= t.maxExt) t.retracting = true;
        // hit test
        const tipX = this.frogX + (t.tx - this.frogX) * (t.ext / t.maxExt);
        const tipY = this.frogY + (t.ty - this.frogY) * (t.ext / t.maxExt);
        this.flies = this.flies.filter(f => {
          const dx = f.x - tipX, dy = f.y - tipY;
          const hr = (FLY_R + 10) / Math.min(this.W, this.H);
          if (dx*dx + dy*dy < hr*hr) {
            t.retracting = true;
            if (f.wasp) {
              this.score = Math.max(0, this.score - 2);
              this._hurtT = 450;
            } else {
              this.score++;
              this.levelFlies++;
              this._checkLevelUp();
            }
            return false;
          }
          return true;
        });
      } else {
        t.ext = Math.max(t.ext - TONGUE_SPD * 1.5 * dt, 0);
        if (t.ext <= 0) this.tongue = null;
      }
    }

    this._emitStats();
  }

  _checkLevelUp() {
    if (this.levelFlies >= this.levelTarget) {
      this.level++;
      this.levelFlies = 0;
      this.timeLeft += LEVEL_BONUS_MS;
      this._banner = { text: `POZIOM ${this.level}!`, t: 1400 };
      // przyspiesz istniejące muchy
      this.flies.forEach(f => { f.vx *= 1.18; f.vy *= 1.18; });
    }
  }

  draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);
    drawGrid(ctx, W, H, 0.03);

    // flies & wasps
    this.flies.forEach(f => {
      if (f.wasp) drawWasp(ctx, f.x*W, f.y*H, f.wingPhase);
      else        drawFly(ctx, f.x*W, f.y*H, f.wingPhase);
    });

    // tongue
    if (this.tongue) {
      const t = this.tongue;
      const ratio = t.ext / t.maxExt;
      const tx2 = this.frogX*W + (t.tx*W - this.frogX*W) * ratio;
      const ty2 = this.frogY*H + (t.ty*H - this.frogY*H) * ratio;
      ctx.save();
      ctx.strokeStyle = '#ec4899';
      ctx.lineWidth   = 5;
      ctx.lineCap     = 'round';
      ctx.beginPath();
      ctx.moveTo(this.frogX*W, this.frogY*H);
      ctx.lineTo(tx2, ty2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(tx2, ty2, 6, 0, Math.PI*2);
      ctx.fillStyle = '#f472b6';
      ctx.fill();
      ctx.restore();
    }

    // frog
    drawFrog(ctx, this.frogX*W, this.frogY*H, W/400);

    // czerwony błysk po ukąszeniu osy
    if (this._hurtT > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(239,68,68,${0.25 * (this._hurtT / 450)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // banner POZIOM X!
    if (this._banner) {
      const a = Math.min(1, this._banner.t / 400);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = '#fbbf24';
      ctx.font = `800 ${Math.round(W/9)}px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = '#f59e0b'; ctx.shadowBlur = 24;
      ctx.fillText(this._banner.text, W/2, H/2.4);
      ctx.restore();
    }
  }

  drawIdle() { this.draw(); }
  destroy()  { this.running = false; }

  _shoot(tx, ty) {
    const dx = tx - this.frogX, dy = ty - this.frogY;
    const len = Math.hypot(dx, dy) || 0.001;
    const maxExt = clamp(len, 0.08, 0.45);
    this.tongue = { tx, ty, ext: 0, maxExt, retracting: false };
  }

  _spawn() {
    const wasp = this.level >= 2 && Math.random() < WASP_CHANCE;
    const spd = FLY_SPEED * (1 + Math.random() * 0.8) * this.speedMult * (wasp ? 1.25 : 1);
    const angle = Math.random() * Math.PI * 2;
    this.flies.push({
      x: rand(0.1, 0.9), y: rand(0.1, 0.9),
      vx: spd * Math.cos(angle), vy: spd * Math.sin(angle),
      wingPhase: Math.random() * Math.PI * 2,
      wasp,
    });
    if (this.flies.length > 8 + this.level) this.flies.shift();
  }

  _emitStats() {
    this.emit('stats',
      `⭐ Poz. <b>${this.level}</b> &nbsp;·&nbsp; ` +
      `🪰 <b>${this.levelFlies}/${this.levelTarget}</b> &nbsp;·&nbsp; ` +
      `<b>${this.score}</b> much &nbsp;·&nbsp; ${Math.ceil(this.timeLeft/1000)}s`);
  }
}

// ── draw helpers ──────────────────────────────────────────
function drawFrog(ctx, x, y, scale) {
  const r = FROG_R * scale;
  ctx.save();
  ctx.shadowColor = '#22c55e'; ctx.shadowBlur = 18;
  // body
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2);
  ctx.fillStyle = '#16a34a'; ctx.fill();
  // eyes
  [[-0.5,-0.6],[0.5,-0.6]].forEach(([ex,ey]) => {
    ctx.beginPath(); ctx.arc(x+ex*r, y+ey*r, r*0.38, 0, Math.PI*2);
    ctx.fillStyle = '#bbf7d0'; ctx.fill();
    ctx.beginPath(); ctx.arc(x+ex*r, y+ey*r, r*0.18, 0, Math.PI*2);
    ctx.fillStyle = '#14532d'; ctx.fill();
  });
  ctx.restore();
}

function drawFly(ctx, x, y, phase) {
  ctx.save();
  const r = FLY_R;
  ctx.shadowColor = '#888'; ctx.shadowBlur = 6;
  // body
  ctx.beginPath(); ctx.ellipse(x, y, r*0.5, r*0.7, 0, 0, Math.PI*2);
  ctx.fillStyle = '#374151'; ctx.fill();
  drawWings(ctx, x, y, r, phase);
  ctx.restore();
}

function drawWasp(ctx, x, y, phase) {
  ctx.save();
  const r = FLY_R * 1.1;
  ctx.shadowColor = '#f59e0b'; ctx.shadowBlur = 10;
  // body — żółty z czarnymi paskami
  ctx.beginPath(); ctx.ellipse(x, y, r*0.55, r*0.8, 0, 0, Math.PI*2);
  ctx.fillStyle = '#fbbf24'; ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.ellipse(x, y, r*0.55, r*0.8, 0, 0, Math.PI*2); ctx.clip();
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(x - r, y - r*0.45, r*2, r*0.22);
  ctx.fillRect(x - r, y + 0,      r*2, r*0.22);
  ctx.fillRect(x - r, y + r*0.45, r*2, r*0.22);
  ctx.restore();
  // żądło
  ctx.beginPath();
  ctx.moveTo(x - r*0.18, y + r*0.7);
  ctx.lineTo(x,          y + r*1.15);
  ctx.lineTo(x + r*0.18, y + r*0.7);
  ctx.fillStyle = '#1f2937'; ctx.fill();
  drawWings(ctx, x, y, r, phase);
  ctx.restore();
}

function drawWings(ctx, x, y, r, phase) {
  const wa = Math.sin(phase) * 0.4;
  ctx.globalAlpha = 0.6;
  ctx.fillStyle   = 'rgba(200,220,255,0.7)';
  [[-1],[1]].forEach(([s]) => {
    ctx.save();
    ctx.translate(x, y - r*0.1);
    ctx.rotate(s * (Math.PI/4 + wa));
    ctx.beginPath(); ctx.ellipse(s*r*0.7, -r*0.15, r*0.7, r*0.3, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  });
  ctx.globalAlpha = 1;
}
