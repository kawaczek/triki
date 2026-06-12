// games/catch/game.js — Catch the Dot
// Sterowanie: przechył kapsla / mysz. Trudność rośnie z wynikiem (poziomy),
// złote kropki ✨ są mniejsze, żyją krócej i dają 3 punkty.

import { clamp, rand, pick, drawGrid, radialGlow } from '../../static/gameutils.js';

const GAME_MS   = 30_000; // 30s
const DOT_R     = 24;
const PLAYER_R  = 18;
const SENS_GZ   = 0.0012 / 33;  // per ms
const SENS_GX   = 0.0012 / 33;
const GOLD_CHANCE = 0.14;
const DOT_COLORS  = ['#ef4444', '#3b82f6', '#f59e0b', '#a855f7', '#ec4899', '#06b6d4'];

export default class CatchTheDot {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas;
    this.ctx    = ctx;
    this.triki  = triki;
    this.emit   = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;
    this.px = 0.5; this.py = 0.5;  // normalized
    this.dots = [];
    this.score = 0;
    this.timeLeft = GAME_MS;
    this._spawnAcc = 0;
    this._mx = 0.5; this._my = 0.5;
  }

  // poziom trudności rośnie co 8 złapanych punktów
  get level() { return 1 + Math.floor(this.score / 8); }

  start(player) {
    this.player  = player;
    this.score   = 0;
    this.timeLeft= GAME_MS;
    this.px      = 0.5; this.py = 0.5;
    this._mx     = 0.5; this._my = 0.5;
    this.dots    = [];
    this._spawnAcc = 0;
    this.running = true;
    this._spawnDot();
  }

  resize(W, H) { this.W = W; this.H = H; }

  onMouseMove(nx, ny) { this._mx = nx; this._my = ny; }
  onClick()           {}
  onKeyDown()         {}

  update(dt) {
    if (!this.running) return;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.running  = false;
      this.emit('end', { score: this.score });
      return;
    }

    // move player
    if (this.triki.connected) {
      this.px -= this.triki.GZ() * SENS_GZ * dt;
      this.py += this.triki.GX() * SENS_GX * dt;
    } else {
      this.px = this.px + (this._mx - this.px) * 0.18;
      this.py = this.py + (this._my - this.py) * 0.18;
    }
    this.px = clamp(this.px, 0, 1);
    this.py = clamp(this.py, 0, 1);

    // spawn — szybciej na wyższych poziomach
    const spawnInt = Math.max(280, 600 - (this.level - 1) * 45);
    this._spawnAcc += dt;
    if (this._spawnAcc >= spawnInt) { this._spawnAcc -= spawnInt; this._spawnDot(); }

    // animate dots
    this.dots.forEach(d => { d.life -= dt; d.scale = Math.max(0, d.life / d.maxLife); });
    this.dots = this.dots.filter(d => d.life > 0);

    // collision
    const px = this.px * this.W;
    const py = this.py * this.H;
    this.dots = this.dots.filter(d => {
      const hitR = (PLAYER_R + d.r) * (this.W / 400);
      const dx = d.x - px, dy = d.y - py;
      if (dx*dx + dy*dy < hitR*hitR) {
        this.score += d.gold ? 3 : 1;
        this._emitStats();
        return false;
      }
      return true;
    });

    this._emitStats();
  }

  draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);
    drawGrid(ctx, W, H);

    // dots
    this.dots.forEach(d => {
      ctx.save();
      ctx.globalAlpha = d.scale * 0.9;
      const r = d.r * d.scale * (W/400);
      radialGlow(ctx, d.x, d.y, r * (d.gold ? 2.8 : 2), d.color, d.gold ? 0.5 : 0.35);
      ctx.beginPath();
      ctx.arc(d.x, d.y, r, 0, Math.PI*2);
      ctx.fillStyle = d.color;
      ctx.fill();
      if (d.gold) {
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.font = `${Math.max(10, r)}px Outfit, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✨', d.x, d.y);
      }
      ctx.restore();
    });

    // player cursor
    const px = this.px * W, py = this.py * H;
    radialGlow(ctx, px, py, PLAYER_R * 2.5 * (W/400), '#22c55e', 0.4);
    ctx.beginPath();
    ctx.arc(px, py, PLAYER_R * (W/400), 0, Math.PI*2);
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth   = 3;
    ctx.stroke();
    ctx.fillStyle   = 'rgba(34,197,94,0.25)';
    ctx.fill();
  }

  drawIdle() { this.draw(); }
  destroy()  { this.running = false; }

  _spawnDot() {
    const gold = Math.random() < GOLD_CHANCE;
    // im wyższy poziom, tym krócej żyją kropki
    const baseLife = Math.max(1200, 2500 - (this.level - 1) * 160);
    const life = (gold ? baseLife * 0.65 : baseLife) + Math.random() * 1600;
    const r = gold ? DOT_R * 0.68 : DOT_R;
    this.dots.push({
      x    : rand(DOT_R, this.W - DOT_R),
      y    : rand(DOT_R, this.H - DOT_R),
      color: gold ? '#fbbf24' : pick(DOT_COLORS),
      gold,
      r,
      life,
      maxLife: life,
      scale: 1,
    });
  }

  _emitStats() {
    const s = Math.ceil(this.timeLeft / 1000);
    this.emit('stats', `⭐ Poz. <b>${this.level}</b> &nbsp;·&nbsp; <b>${this.score}</b> pkt &nbsp;·&nbsp; ${s}s`);
  }
}
