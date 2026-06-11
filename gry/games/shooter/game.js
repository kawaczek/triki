// games/shooter/game.js — Kosmo Żaba
// Żabka w spodku broni galaktyki: przechył = ruch statku, klik = strzał.
// Fale wrogów przyspieszają z poziomami (co 12 zestrzeleń). 3 życia.

import { clamp, rand, pick, radialGlow } from '../../static/gameutils.js';

const SHIP_Y     = 0.88;       // pozycja statku (znormalizowana)
const SENS       = 0.0011 / 16; // czułość przechyłu na ms
const SHOT_CD    = 260;        // cooldown strzału ms
const BULLET_V   = -0.0011;    // prędkość pocisku (frakcja H na ms)
const KILLS_PER_LEVEL = 12;
const LIVES      = 3;

const ENEMY_TYPES = [
  { emoji: '👾', hp: 1, v: 0.00012, r: 0.045, score: 10, color: '#a855f7' },
  { emoji: '🛸', hp: 2, v: 0.00017, r: 0.042, score: 20, color: '#3b82f6' },
  { emoji: '☄️', hp: 3, v: 0.00009, r: 0.055, score: 30, color: '#ef4444' },
];

export default class ShooterGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas;
    this.ctx    = ctx;
    this.triki  = triki;
    this.emit   = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;
    this._mx = 0.5;
    this._keys = {};

    this.shipX = 0.5;
    this.bullets = [];
    this.enemies = [];
    this.particles = [];
    this.stars = [];
    this.score = 0;
    this.kills = 0;
    this.lives = LIVES;
    this._shotCd = 0;
    this._spawnAcc = 0;
    this._hurtT = 0;
    this._banner = null;
    this._initStars();
  }

  get level() { return 1 + Math.floor(this.kills / KILLS_PER_LEVEL); }

  _initStars() {
    this.stars = [];
    for (let i = 0; i < 42; i++) {
      this.stars.push({ x: Math.random(), y: Math.random(), s: rand(0.5, 1.8), v: rand(0.00002, 0.00008) });
    }
  }

  start(player) {
    this.player = player;
    this.shipX = 0.5;
    this.bullets = [];
    this.enemies = [];
    this.particles = [];
    this.score = 0;
    this.kills = 0;
    this.lives = LIVES;
    this._shotCd = 0;
    this._spawnAcc = 0;
    this._hurtT = 0;
    this._lastLevel = 1;
    this._banner = {text: 'POZIOM 1', t: 1200};
    this.running = true;
    this._emitStats();
  }

  resize(W, H) { this.W = W; this.H = H; }

  onMouseMove(nx) { this._mx = nx; }
  onClick() { this._shoot(); }
  onKeyDown(code) {
    this._keys[code] = true;
    if (code === 'Space') this._shoot();
  }
  onKeyUp(code) { this._keys[code] = false; }

  _shoot() {
    if (!this.running || this._shotCd > 0) return;
    this._shotCd = SHOT_CD;
    this.bullets.push({ x: this.shipX, y: SHIP_Y - 0.05 });
    for (let i = 0; i < 3; i++) {
      this.particles.push({
        x: this.shipX, y: SHIP_Y - 0.05,
        vx: rand(-0.00012, 0.00012), vy: rand(-0.0004, -0.0002),
        life: 160, maxLife: 160, color: '#86efac', size: 2.5,
      });
    }
  }

  update(dt) {
    if (!this.running) return;
    if (this._banner) { this._banner.t -= dt; if (this._banner.t <= 0) this._banner = null; }
    if (this._hurtT > 0) this._hurtT -= dt;
    if (this._shotCd > 0) this._shotCd -= dt;

    // gwiazdy tła
    this.stars.forEach(s => { s.y += s.v * dt; if (s.y > 1) { s.y = 0; s.x = Math.random(); } });

    // ruch statku
    if (this.triki.connected) {
      this.shipX -= this.triki.GZ() * SENS * dt;
      if (this.triki.consumeClick()) this._shoot();
    } else if (this._keys.ArrowLeft || this._keys.KeyA) {
      this.shipX -= 0.0006 * dt;
    } else if (this._keys.ArrowRight || this._keys.KeyD) {
      this.shipX += 0.0006 * dt;
    } else {
      this.shipX += (this._mx - this.shipX) * 0.16;
    }
    this.shipX = clamp(this.shipX, 0.05, 0.95);

    // spawn wrogów — częściej i szybciej na wyższych poziomach
    const spawnInt = Math.max(380, 1100 - (this.level - 1) * 110);
    this._spawnAcc += dt;
    if (this._spawnAcc >= spawnInt) {
      this._spawnAcc -= spawnInt;
      // na wyższych poziomach mocniejsi wrogowie częściej
      const maxType = Math.min(ENEMY_TYPES.length, 1 + Math.floor(this.level / 2));
      const t = pick(ENEMY_TYPES.slice(0, maxType));
      this.enemies.push({
        x: rand(0.08, 0.92), y: -0.05,
        v: t.v * (1 + (this.level - 1) * 0.09),
        wob: rand(0, Math.PI * 2), wobAmp: rand(0.00004, 0.00012),
        hp: t.hp, maxHp: t.hp, r: t.r,
        emoji: t.emoji, color: t.color, scoreValue: t.score,
      });
    }

    // pociski
    this.bullets.forEach(b => { b.y += BULLET_V * dt; });
    this.bullets = this.bullets.filter(b => b.y > -0.05);

    // wrogowie
    this.enemies.forEach(e => {
      e.y += e.v * dt;
      e.wob += dt * 0.003;
      e.x = clamp(e.x + Math.sin(e.wob) * e.wobAmp * dt, 0.04, 0.96);
    });

    // trafienia pocisków
    this.bullets = this.bullets.filter(b => {
      let hit = false;
      this.enemies.forEach(e => {
        if (hit || e.hp <= 0) return;
        const dx = (b.x - e.x) * this.W, dy = (b.y - e.y) * this.H;
        const rr = e.r * Math.min(this.W, this.H) + 5;
        if (dx*dx + dy*dy < rr*rr) {
          hit = true;
          e.hp--;
          this._boom(e.x, e.y, e.color, 4);
        }
      });
      return !hit;
    });

    // zniszczeni wrogowie
    this.enemies = this.enemies.filter(e => {
      if (e.hp <= 0) {
        this.kills++;
        this.score += e.scoreValue;
        this._boom(e.x, e.y, e.color, 14);
        const lvl = this.level;
        if (lvl > this._lastLevel) {
          this._lastLevel = lvl;
          this._banner = {text: `POZIOM ${lvl}!`, t: 1200};
        }
        this._emitStats();
        return false;
      }
      return true;
    });

    // wróg dotarł do dołu / zderzył się ze statkiem
    this.enemies = this.enemies.filter(e => {
      const dx = (e.x - this.shipX) * this.W, dy = (e.y - SHIP_Y) * this.H;
      const rr = (e.r + 0.05) * Math.min(this.W, this.H);
      const hitShip = dx*dx + dy*dy < rr*rr;
      const escaped = e.y > 1.02;
      if (hitShip || escaped) {
        this.lives--;
        this._hurtT = 420;
        this._boom(e.x, Math.min(e.y, 1), '#ef4444', 12);
        this._emitStats();
        if (this.lives <= 0) {
          this.running = false;
          this.emit('end', { score: this.score });
        }
        return false;
      }
      return true;
    });
    if (!this.running) return;

    // cząsteczki
    this.particles.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; });
    this.particles = this.particles.filter(p => p.life > 0);
  }

  _boom(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(0.00008, 0.0003);
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(250, 500), maxLife: 500, color, size: rand(2, 4.5),
      });
    }
  }

  draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    // gwiazdy
    ctx.save();
    this.stars.forEach(s => {
      ctx.globalAlpha = 0.25 + s.s * 0.2;
      ctx.fillStyle = '#dbeafe';
      ctx.fillRect(s.x * W, s.y * H, s.s, s.s);
    });
    ctx.restore();

    // cząsteczki
    this.particles.forEach(p => {
      ctx.save();
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x * W, p.y * H, p.size, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    });

    // pociski
    ctx.save();
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.shadowColor = '#4ade80'; ctx.shadowBlur = 8;
    this.bullets.forEach(b => {
      ctx.beginPath();
      ctx.moveTo(b.x * W, b.y * H);
      ctx.lineTo(b.x * W, b.y * H + 12);
      ctx.stroke();
    });
    ctx.restore();

    // wrogowie
    this.enemies.forEach(e => {
      const ex = e.x * W, ey = e.y * H;
      const er = e.r * Math.min(W, H);
      radialGlow(ctx, ex, ey, er * 1.6, e.color, 0.25);
      ctx.font = `${er * 1.7}px Outfit, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(e.emoji, ex, ey);
      if (e.hp < e.maxHp) {
        const bw = er * 1.6;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(ex - bw/2, ey - er - 8, bw, 3.5);
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(ex - bw/2, ey - er - 8, bw * (e.hp / e.maxHp), 3.5);
      }
    });

    // statek: spodek + żabka
    const sx = this.shipX * W, sy = SHIP_Y * H;
    const sr = Math.min(W, H) * 0.052;
    ctx.save();
    if (this._hurtT > 0 && Math.floor(this._hurtT / 70) % 2 === 0) ctx.globalAlpha = 0.35;
    radialGlow(ctx, sx, sy + sr*0.5, sr * 2.4, '#22c55e', 0.3);
    // płomień silnika
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.moveTo(sx - sr*0.3, sy + sr*0.55);
    ctx.lineTo(sx, sy + sr*1.15 + Math.random()*4);
    ctx.lineTo(sx + sr*0.3, sy + sr*0.55);
    ctx.fill();
    // spodek
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.ellipse(sx, sy + sr*0.35, sr*1.15, sr*0.42, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.ellipse(sx, sy + sr*0.22, sr*0.85, sr*0.3, 0, 0, Math.PI*2);
    ctx.fill();
    // kopuła z żabką
    ctx.fillStyle = 'rgba(147, 197, 253, 0.25)';
    ctx.beginPath();
    ctx.arc(sx, sy, sr*0.62, Math.PI, 0);
    ctx.fill();
    ctx.font = `${sr * 0.85}px Outfit, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🐸', sx, sy - sr*0.08);
    ctx.restore();

    // błysk obrażeń
    if (this._hurtT > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(239,68,68,${0.2 * (this._hurtT / 420)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // banner poziomu
    if (this._banner) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this._banner.t / 350);
      ctx.fillStyle = '#3b82f6';
      ctx.font = `800 ${Math.round(W/9)}px Outfit, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = '#3b82f6'; ctx.shadowBlur = 22;
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
      `⭐ Poz. <b>${this.level}</b> &nbsp;·&nbsp; ` +
      `🏆 <b>${this.score}</b>`);
  }
}
