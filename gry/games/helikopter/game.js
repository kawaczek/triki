// games/helikopter/game.js — Helikopter
// Klasyczna gra helikopter z 2000s. Triki: przytrzymanie guzika = silnik.
// Tunel przewija się z prawej w lewo, grawitacja ciągnie w dół.

import { clamp, rand } from '../../static/gameutils.js';

const SPD_MIN   = 0.20;   // px/ms start
const SPD_MAX   = 0.50;   // px/ms max
const SPD_ACCEL = 0.000020; // wzrost prędkości
const GRAVITY   = 0.0000007;  // vy += per ms (frakcja H / ms²)
const THRUST    = 0.0000017;  // vy -= per ms gdy silnik włączony (frakcja H / ms²)
const VY_MAX    = 0.00035;    // max |vy| (frakcja H / ms)
const SEG_W     = 200;    // px — szerokość jednego segmentu tunelu
const GAP_FRAC  = 0.45;   // szerokość przejścia / H
const GAP_DRIFT = 20;     // max px driftu górnej ściany między segmentami
const HELI_X    = 0.18;   // znorm. X helikoptera
const OBST_DIST = 500;    // m — od kiedy słupki
const SCORE_SCALE = 0.1;

export default class HelikopterGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas  = canvas;
    this.ctx     = ctx;
    this.triki   = triki;
    this.emit    = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;

    // stan helikoptera
    this.heliY  = 0.5;  // znorm.
    this.velY   = 0;    // znorm. prędkość pionowa
    this.thrust = false;

    // tunel
    this.segments  = [];  // {x, topH, gapH, obst?}
    this.scrollX   = 0;   // o ile przesunęliśmy w px (całkowity offset)
    this.speed     = SPD_MIN;

    // wynik
    this.score     = 0;
    this._gameOver = false;

    // animacja wirnika
    this._rotorAngle = 0;

    // sterowanie klawiaturą/myszą (fallback gdy brak BLE)
    this._keyThrust    = false;
    this._thrustToggle = false;

    // speed lines
    this._speedLines = [];
    for (let i = 0; i < 14; i++) {
      this._speedLines.push({ x: Math.random(), y: rand(0.1, 0.9), len: rand(0.04, 0.10), spd: rand(0.6, 1.0) });
    }

    this._buildInitialTunnel();
  }

  _buildInitialTunnel() {
    this.segments = [];
    // zaczynamy od środka
    let topH = 0.28; // górna ściana (znorm.)
    const needed = Math.ceil(this.W / SEG_W) + 3;
    for (let i = 0; i < needed; i++) {
      topH = this._nextTopH(topH);
      this.segments.push(this._makeSegment(i * SEG_W, topH, false));
    }
  }

  _nextTopH(prev) {
    const delta = (Math.random() - 0.5) * 2 * GAP_DRIFT / (this.H || 600);
    return clamp(prev + delta, 0.05, 1 - GAP_FRAC - 0.05);
  }

  _makeSegment(x, topH, withObst) {
    const seg = { x, topH, gapH: GAP_FRAC, obst: null };
    if (withObst && Math.random() < 0.5) {
      // słupek z góry lub dołu
      const fromTop = Math.random() < 0.5;
      const obsH = rand(0.08, 0.18);
      seg.obst = {
        fromTop,
        h: obsH,
        w: 18, // px
        x: x + SEG_W * 0.5,
      };
    }
    return seg;
  }

  start(player) {
    this.player    = player;
    this.heliY     = 0.5;
    this.velY      = 0;
    this.thrust    = false;
    this.speed     = SPD_MIN;
    this.score     = 0;
    this._gameOver = false;
    this.scrollX   = 0;
    this._rotorAngle = 0;
    this._keyThrust    = false;
    this._thrustToggle = false;
    this._buildInitialTunnel();
    this.running   = true;
    this._emitStats();
  }

  resize(W, H) { this.W = W; this.H = H; this._buildInitialTunnel(); }

  onMouseMove() {}
  // klik (touch): start/stop silnika (toggle)
  onClick() { this._thrustToggle = !this._thrustToggle; }
  onKeyDown(code) {
    if (code === 'Space' || code === 'ArrowUp') this._keyThrust = true;
  }
  onKeyUp(code) {
    if (code === 'Space' || code === 'ArrowUp') this._keyThrust = false;
  }

  update(dt) {
    if (!this.running) return;

    // silnik: triki._btn = przytrzymanie fizycznego guzika
    if (this.triki.connected) {
      this.thrust = !!this.triki._btn;
    } else {
      // klawiatura: Space/ArrowUp; mysz/touch: toggle
      this.thrust = !!(this._keyThrust || this._thrustToggle);
    }

    // prędkość przewijania
    this.speed = Math.min(SPD_MAX, this.speed + SPD_ACCEL * dt);

    // wynik
    const prevScore = Math.floor(this.score);
    this.score += this.speed * dt * SCORE_SCALE;
    if (Math.floor(this.score) !== prevScore) this._emitStats();

    // fizyka helikoptera
    if (this.thrust) {
      this.velY -= THRUST * dt;
    } else {
      this.velY += GRAVITY * dt;
    }
    this.velY = clamp(this.velY, -VY_MAX, VY_MAX);
    this.heliY = clamp(this.heliY + this.velY * dt, 0, 1);

    // animacja wirnika
    this._rotorAngle += (this.thrust ? 0.022 : 0.010) * dt;

    // speed lines
    this._speedLines.forEach(sl => {
      sl.x -= sl.spd * this.speed * dt / this.W;
      if (sl.x + sl.len < 0) { sl.x = 1 + sl.len; sl.y = rand(0.1, 0.9); }
    });

    // scroll tunelu
    this.scrollX += this.speed * dt;

    // usuń segmenty za ekranem
    this.segments = this.segments.filter(s => s.x - this.scrollX + SEG_W > -50);

    // dodaj nowe segmenty (aż do 2 segmenty poza prawą krawędzią)
    while (true) {
      const last = this.segments[this.segments.length - 1];
      if (last && (last.x - this.scrollX) >= this.W + SEG_W) break;
      if (this.segments.length > 60) break;
      const newX  = last ? last.x + SEG_W : 0;
      const topH  = this._nextTopH(last ? last.topH : 0.28);
      const withOb = this.score >= OBST_DIST;
      this.segments.push(this._makeSegment(newX, topH, withOb));
    }

    // kolizja helikoptera
    const { W, H } = this;
    const heliPx = HELI_X * W;
    const heliPy = this.heliY * H;
    const heliR  = W * 0.022; // promień hitboxu

    for (const seg of this.segments) {
      const sx = seg.x - this.scrollX;
      if (sx > heliPx + heliR * 2 || sx + SEG_W < heliPx - heliR * 2) continue;

      const topWallH  = seg.topH * H;
      const botWallY  = (seg.topH + seg.gapH) * H;

      // górna ściana
      if (heliPy - heliR < topWallH) { this._die(); return; }
      // dolna ściana
      if (heliPy + heliR > botWallY) { this._die(); return; }

      // słupek
      if (seg.obst) {
        const ox = seg.obst.x - this.scrollX;
        const ow = seg.obst.w;
        if (Math.abs(heliPx - ox) < heliR + ow * 0.5) {
          if (seg.obst.fromTop) {
            const obsBottom = (seg.topH + seg.obst.h) * H;
            if (heliPy - heliR < obsBottom) { this._die(); return; }
          } else {
            const obsTop = (seg.topH + seg.gapH - seg.obst.h) * H;
            if (heliPy + heliR > obsTop) { this._die(); return; }
          }
        }
      }
    }
  }

  _die() {
    this.running   = false;
    this._gameOver = true;
    this.emit('end', { score: Math.floor(this.score) });
  }

  draw() {
    const { ctx, W, H } = this;

    // tło — ciemny tunel
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, W, H);

    // speed lines
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    this._speedLines.forEach(sl => {
      const sx = sl.x * W, sy = sl.y * H;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - sl.len * W, sy);
      ctx.stroke();
    });
    ctx.restore();

    // rysuj tunel: ściany per segment
    for (const seg of this.segments) {
      const sx = seg.x - this.scrollX;
      if (sx > W + 10 || sx + SEG_W < -10) continue;
      const topH   = seg.topH * H;
      const botY   = (seg.topH + seg.gapH) * H;

      // górna ściana
      _drawWallSegment(ctx, sx, 0, SEG_W, topH);
      // dolna ściana
      _drawWallSegment(ctx, sx, botY, SEG_W, H - botY);

      // stalaktyt / stalagmit
      if (seg.obst) {
        const ox = seg.obst.x - this.scrollX;
        const ow = seg.obst.w;
        if (seg.obst.fromTop) {
          const oh = seg.obst.h * H;
          _drawObstacle(ctx, ox, topH, ow, oh, true);
        } else {
          const oh = seg.obst.h * H;
          _drawObstacle(ctx, ox, botY - oh, ow, oh, false);
        }
      }
    }

    // krawędź tunelu (poświata)
    ctx.save();
    ctx.strokeStyle = '#1e40af';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#3b82f6';
    ctx.shadowBlur = 10;
    for (const seg of this.segments) {
      const sx = seg.x - this.scrollX;
      if (sx > W + 10 || sx + SEG_W < -10) continue;
      const topH = seg.topH * H;
      const botY = (seg.topH + seg.gapH) * H;
      ctx.beginPath(); ctx.moveTo(sx, topH); ctx.lineTo(Math.min(sx + SEG_W, W + 10), topH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx, botY); ctx.lineTo(Math.min(sx + SEG_W, W + 10), botY); ctx.stroke();
    }
    ctx.restore();

    // helikopter
    const heliPx = HELI_X * W;
    const heliPy = this.heliY * H;
    _drawHeli(ctx, heliPx, heliPy, W, this._rotorAngle, this.thrust);

    // HUD dystans
    // (stats przez emit)
  }

  drawIdle() { this.draw(); }
  destroy()  { this.running = false; }

  _emitStats() {
    const spd = (this.speed * 1000 / 10).toFixed(0); // "pixel/s" → m/s-ish
    this.emit('stats', `🚁 <b>${Math.floor(this.score)}</b> m`);
  }
}

// ── draw helpers ──────────────────────────────────────────

function _drawWallSegment(ctx, x, y, w, h) {
  if (h <= 0) return;
  // gradient skała
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#374151');
  g.addColorStop(1, '#1f2937');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);

  // nierówna tekstura — drobne linie
  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.strokeStyle = '#6b7280';
  ctx.lineWidth = 1;
  for (let lx = x; lx < x + w; lx += 18) {
    ctx.beginPath(); ctx.moveTo(lx, y); ctx.lineTo(lx, y + h); ctx.stroke();
  }
  ctx.restore();
}

function _drawObstacle(ctx, cx, y, w, h, fromTop) {
  // stalaktyt/stalagmit — kamienisty słupek
  ctx.save();
  const g = ctx.createLinearGradient(cx, y, cx + w, y + h);
  g.addColorStop(0, '#4b5563');
  g.addColorStop(1, '#6b7280');
  ctx.fillStyle = g;
  ctx.shadowColor = '#ef4444';
  ctx.shadowBlur = 6;

  const hw = w / 2;
  ctx.beginPath();
  if (fromTop) {
    ctx.moveTo(cx - hw, y);
    ctx.lineTo(cx + hw, y);
    ctx.lineTo(cx + hw * 0.5, y + h);
    ctx.lineTo(cx - hw * 0.5, y + h);
  } else {
    ctx.moveTo(cx - hw * 0.5, y);
    ctx.lineTo(cx + hw * 0.5, y);
    ctx.lineTo(cx + hw, y + h);
    ctx.lineTo(cx - hw, y + h);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function _drawHeli(ctx, x, y, W, rotorAngle, thrust) {
  const sc = W / 420;
  ctx.save();
  ctx.translate(x, y);

  // blask silnika
  if (thrust) {
    ctx.save();
    ctx.globalAlpha = 0.25 + 0.1 * Math.sin(rotorAngle * 8);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 40 * sc);
    g.addColorStop(0, '#fbbf24');
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 40 * sc, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ogon
  ctx.fillStyle = '#1d4ed8';
  ctx.beginPath();
  ctx.moveTo(-20 * sc, -4 * sc);
  ctx.lineTo(-42 * sc, -2 * sc);
  ctx.lineTo(-40 * sc, 6 * sc);
  ctx.lineTo(-16 * sc, 8 * sc);
  ctx.closePath();
  ctx.fill();

  // usterzenie ogonowe (małe)
  ctx.fillStyle = '#2563eb';
  ctx.beginPath();
  ctx.moveTo(-40 * sc, -2 * sc);
  ctx.lineTo(-50 * sc, -14 * sc);
  ctx.lineTo(-38 * sc, -2 * sc);
  ctx.closePath();
  ctx.fill();

  // kadłub główny
  const bodyG = ctx.createLinearGradient(-22 * sc, -14 * sc, 22 * sc, 14 * sc);
  bodyG.addColorStop(0, '#3b82f6');
  bodyG.addColorStop(1, '#1d4ed8');
  ctx.fillStyle = bodyG;
  ctx.beginPath();
  ctx.ellipse(0, 2 * sc, 26 * sc, 14 * sc, 0, 0, Math.PI * 2);
  ctx.fill();

  // szyba kokpitu
  ctx.fillStyle = 'rgba(186,230,253,0.55)';
  ctx.beginPath();
  ctx.ellipse(10 * sc, -2 * sc, 13 * sc, 10 * sc, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1 * sc;
  ctx.stroke();

  // płozy
  ctx.strokeStyle = '#93c5fd';
  ctx.lineWidth = 2.5 * sc;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-18 * sc, 14 * sc); ctx.lineTo(20 * sc, 14 * sc); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-6 * sc, 14 * sc);  ctx.lineTo(-6 * sc, 8 * sc);  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(8 * sc, 14 * sc);   ctx.lineTo(8 * sc, 8 * sc);   ctx.stroke();

  // wirnik główny (obracający się)
  ctx.save();
  ctx.rotate(rotorAngle);
  ctx.strokeStyle = '#bfdbfe';
  ctx.lineWidth = 3.5 * sc;
  ctx.lineCap = 'round';
  ctx.shadowColor = '#93c5fd';
  ctx.shadowBlur = 5;
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate(i * Math.PI * 2 / 3);
    ctx.beginPath();
    ctx.moveTo(-3 * sc, -3 * sc);
    ctx.lineTo(-38 * sc, -3 * sc);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // wirnik ogonowy (mały)
  ctx.save();
  ctx.translate(-41 * sc, 2 * sc);
  ctx.rotate(rotorAngle * 2.5);
  ctx.strokeStyle = '#93c5fd';
  ctx.lineWidth = 2 * sc;
  for (let i = 0; i < 2; i++) {
    ctx.save();
    ctx.rotate(i * Math.PI);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -10 * sc); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // efekt silnika — mała pochodnia
  if (thrust) {
    ctx.save();
    ctx.globalAlpha = 0.7 + 0.3 * Math.random();
    const fl = ctx.createLinearGradient(12 * sc, 8 * sc, 12 * sc, 22 * sc);
    fl.addColorStop(0, '#fbbf24');
    fl.addColorStop(1, 'rgba(239,68,68,0)');
    ctx.fillStyle = fl;
    ctx.beginPath();
    ctx.ellipse(12 * sc, 15 * sc, 4 * sc, 8 * sc + Math.random() * 4 * sc, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}
