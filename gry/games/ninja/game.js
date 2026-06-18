// games/ninja/game.js — Ninja Slash
// Sterowanie: przechyl = pozycja ostrza (poziomo), potrząśnij = cios
// Tnij owoce (+10 pkt), omijaj bomby (-1 życie), nie pozwól owocom spaść (-1 życie)

import { clamp, rand, pick, drawGrid, radialGlow } from '../../static/gameutils.js';

const GRAVITY       = 0.0006;   // px/ms² — przyspieszenie grawitacji
const SPAWN_BASE_MS = 1800;     // bazowy interwał spawnu [ms]
const SPAWN_MIN_MS  = 600;      // minimalny interwał spawnu [ms]
const FRUIT_EMOJIS  = ['🍎', '🍊', '🍋', '🍇', '🍓'];
const FRUIT_COLORS  = ['#ef4444', '#f97316', '#eab308', '#a855f7', '#ec4899'];
const LIVES_START   = 5;
const HIT_RANGE     = 70;        // ±px od bladeX do kolizji

export default class NinjaGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas  = canvas;
    this.ctx     = ctx;
    this.triki   = triki;
    this.emit    = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;

    // stan gry — inicjalizowany tu, bo drawIdle() może byc wywołane przed start()
    this.score      = 0;
    this.lives      = LIVES_START;
    this.bladeX     = this.W / 2;
    this.objects    = [];       // {x, y, vx, vy, r, emoji, color, isBomb, sliced, age}
    this.particles  = [];       // {x, y, vx, vy, color, life, maxLife, r}
    this.halves     = [];       // {x, y, vx, vy, color, r, angle, life, maxLife, side}
    this._spawnAcc  = 0;
    this._spawnInt  = SPAWN_BASE_MS;
    this._accelAcc  = 0;        // akumulator przyspieszenia co 10s
    this._slashAnim = 0;        // ms trwania animacji cięcia
    this._bombFlash = 0;        // ms trwania czerwonego flashu
    this._mx        = 0.5;      // pozycja myszy (fallback)
  }

  start(player) {
    this.player    = player;
    this.score     = 0;
    this.lives     = LIVES_START;
    this.bladeX    = this.W / 2;
    this.objects   = [];
    this.particles = [];
    this.halves    = [];
    this._spawnAcc = 0;
    this._spawnInt = SPAWN_BASE_MS;
    this._accelAcc = 0;
    this._slashAnim = 0;
    this._bombFlash = 0;
    this.running   = true;
    this._emitStats();
  }

  resize(W, H) { this.W = W; this.H = H; this.bladeX = clamp(this.bladeX, W * 0.1, W * 0.9); }

  onMouseMove(nx, ny) { this._mx = nx; }
  onClick()    {}
  onKeyDown()  {}

  update(dt) {
    if (!this.running) return;

    // ── blade position ──────────────────────────────────────────
    if (this.triki.connected) {
      // -GZ() = prawo w schemacie tilt
      const gz = -this.triki.GZ();
      this.bladeX += gz * 0.003 * dt;
    } else {
      // mysz: lerp do pozycji kursora
      this.bladeX += (this._mx * this.W - this.bladeX) * Math.min(1, dt * 0.012);
    }
    this.bladeX = clamp(this.bladeX, this.W * 0.1, this.W * 0.9);

    // ── animacje timery ──────────────────────────────────────────
    this._slashAnim = Math.max(0, this._slashAnim - dt);
    this._bombFlash = Math.max(0, this._bombFlash - dt);

    // ── przyspieszenie tempa co 10s ──────────────────────────────
    this._accelAcc += dt;
    if (this._accelAcc >= 10_000) {
      this._accelAcc -= 10_000;
      this._spawnInt = Math.max(SPAWN_MIN_MS, this._spawnInt - 150);
    }

    // ── spawn ───────────────────────────────────────────────────
    this._spawnAcc += dt;
    if (this._spawnAcc >= this._spawnInt) {
      this._spawnAcc -= this._spawnInt + rand(0, this._spawnInt * 0.5);
      this._spawnObject();
    }

    // ── fizyka obiektów ─────────────────────────────────────────
    for (const o of this.objects) {
      o.vy += GRAVITY * dt;
      o.x  += o.vx * dt;
      o.y  += o.vy * dt;
      o.age += dt;
    }

    // ── sprawdź owoce które wypadły z ekranu ────────────────────
    const toRemove = [];
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i];
      if (o.y - o.r > this.H) {
        if (!o.isBomb && !o.sliced) {
          // owoc spadł — strata życia
          this._loseLife();
          this._emitStats();
        }
        toRemove.push(i);
      }
      // usuń też obiekty które wylecą bokiem (bezpieczne)
      if (o.x < -100 || o.x > this.W + 100) {
        toRemove.push(i);
      }
    }
    for (const i of toRemove) this.objects.splice(i, 1);

    // ── cięcie (shake) ──────────────────────────────────────────
    if (this.triki.consumeShake()) {
      this._slash();
    }

    // ── fizyka połówek i cząsteczek ─────────────────────────────
    for (const h of this.halves) {
      h.vy += GRAVITY * dt;
      h.x  += h.vx * dt;
      h.y  += h.vy * dt;
      h.angle += h.spin * dt;
      h.life -= dt;
    }
    this.halves = this.halves.filter(h => h.life > 0);

    for (const p of this.particles) {
      p.vy += GRAVITY * 0.3 * dt;
      p.x  += p.vx * dt;
      p.y  += p.vy * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter(p => p.life > 0);
  }

  draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    // tło z lekkim flashem przy bombie
    if (this._bombFlash > 0) {
      const alpha = (this._bombFlash / 300) * 0.45;
      ctx.fillStyle = `rgba(220,30,30,${alpha})`;
      ctx.fillRect(0, 0, W, H);
    }

    drawGrid(ctx, W, H);

    // połówki owoców
    for (const h of this.halves) {
      const alpha = clamp(h.life / h.maxLife, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(h.x, h.y);
      ctx.rotate(h.angle);
      ctx.beginPath();
      ctx.arc(0, 0, h.r, 0, Math.PI, h.side === 'right');
      ctx.fillStyle = h.color + '99';
      ctx.strokeStyle = h.color;
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // cząsteczki soku
    for (const p of this.particles) {
      const alpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.restore();
    }

    // obiekty (owoce i bomby)
    for (const o of this.objects) {
      ctx.save();
      const r = o.r * (W / 400);
      radialGlow(ctx, o.x, o.y, r * 1.8, o.color, o.isBomb ? 0.15 : 0.3);
      ctx.beginPath();
      ctx.arc(o.x, o.y, r, 0, Math.PI * 2);
      ctx.fillStyle = o.isBomb ? '#1a1a2e' : o.color + '55';
      ctx.strokeStyle = o.color;
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
      // emoji
      ctx.font = `${Math.round(r * 1.1)}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(o.emoji, o.x, o.y);
      ctx.restore();
    }

    // ostrze ninja
    this._drawBlade();

    // życia (serduszka)
    this._drawLives();

    // wynik na środku góry
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = `bold ${Math.round(W / 14)}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(this.score + ' pkt', W / 2, 8);
    ctx.restore();
  }

  drawIdle() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);
    drawGrid(ctx, W, H);

    // kilka dekoracyjnych owoców w tle
    const idleFruits = [
      { x: W * 0.2, y: H * 0.35, emoji: '🍎', color: '#ef4444' },
      { x: W * 0.5, y: H * 0.25, emoji: '🍊', color: '#f97316' },
      { x: W * 0.8, y: H * 0.45, emoji: '🍇', color: '#a855f7' },
      { x: W * 0.35, y: H * 0.6, emoji: '💣', color: '#374151' },
      { x: W * 0.65, y: H * 0.55, emoji: '🍓', color: '#ec4899' },
    ];
    const r = (W / 400) * 32;
    for (const f of idleFruits) {
      radialGlow(ctx, f.x, f.y, r * 2, f.color, 0.25);
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.font = `${Math.round(r * 1.1)}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(f.emoji, f.x, f.y);
    }

    // ostrze w centrum
    const bx = W / 2;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(bx, 0);
    ctx.lineTo(bx, H);
    ctx.strokeStyle = 'rgba(100,200,255,0.35)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  destroy() { this.running = false; }

  // ── prywatne ─────────────────────────────────────────────────

  _spawnObject() {
    const isBomb = Math.random() < 0.2;
    const emojiIdx = Math.floor(Math.random() * FRUIT_EMOJIS.length);
    const margin = 50;
    const x = rand(margin, this.W - margin);
    // vy ujemne = leci w górę; losujemy siłę rzutu
    const speedScale = 0.55 + (this.W / 400) * 0.2;
    const vy0 = -rand(0.7, 1.15) * speedScale;  // px/ms
    // lekki tor ukośny
    const vx = rand(-0.15, 0.15);
    const r = rand(28, 36);
    this.objects.push({
      x,
      y: this.H + r,
      vx,
      vy: vy0,
      r,
      emoji : isBomb ? '💣' : FRUIT_EMOJIS[emojiIdx],
      color : isBomb ? '#374151' : FRUIT_COLORS[emojiIdx],
      isBomb,
      sliced: false,
      age   : 0,
    });
  }

  _slash() {
    this._slashAnim = 180;
    let hit = false;

    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i];
      if (o.sliced) continue;
      const dist = Math.abs(o.x - this.bladeX);
      if (dist > HIT_RANGE * (this.W / 400)) continue;

      // trafienie!
      o.sliced = true;
      this.objects.splice(i, 1);
      hit = true;

      if (o.isBomb) {
        // bomba — strata życia + flash
        this._bombFlash = 300;
        this._loseLife();
      } else {
        // owoc — punkty + animacja
        this.score += 10;
        this._spawnHalves(o);
        this._spawnJuice(o);
      }
    }

    if (hit) this._emitStats();
  }

  _spawnHalves(o) {
    const base = { x: o.x, y: o.y, vy: o.vy * 0.6, r: o.r, color: o.color, life: 500, maxLife: 500 };
    this.halves.push({ ...base, vx: o.vx - 0.25, angle: 0, spin: -0.006, side: 'left' });
    this.halves.push({ ...base, vx: o.vx + 0.25, angle: Math.PI, spin: 0.006, side: 'right' });
  }

  _spawnJuice(o) {
    const count = 8 + Math.floor(Math.random() * 6);
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i / count) + rand(-0.3, 0.3);
      const speed = rand(0.15, 0.45);
      this.particles.push({
        x    : o.x,
        y    : o.y,
        vx   : Math.cos(angle) * speed,
        vy   : Math.sin(angle) * speed - 0.2,
        color: o.color,
        r    : rand(3, 7),
        life : rand(300, 600),
        maxLife: 600,
      });
    }
  }

  _loseLife() {
    this.lives--;
    if (this.lives <= 0) {
      this.lives = 0;
      this.running = false;
      this.emit('end', { score: this.score });
    }
  }

  _drawBlade() {
    const { ctx, W, H } = this;
    const bx = this.bladeX;
    const glowing = this._slashAnim > 0;
    const alpha = glowing ? 1 : 0.5;
    const lineW = glowing ? 4 : 2;
    const color = glowing ? '#7dd3fc' : '#93c5fd';

    ctx.save();
    if (glowing) {
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur  = 18;
    }
    ctx.beginPath();
    ctx.moveTo(bx, 0);
    ctx.lineTo(bx, H);
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth   = lineW;
    ctx.stroke();

    // czubek ostrza (trójkąt)
    const ty = H * 0.12;
    ctx.beginPath();
    ctx.moveTo(bx, ty - 18);
    ctx.lineTo(bx - 10, ty + 10);
    ctx.lineTo(bx + 10, ty + 10);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  _drawLives() {
    const { ctx, W } = this;
    const sz = Math.max(16, W / 16);
    ctx.save();
    ctx.font = `${sz}px serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (let i = 0; i < LIVES_START; i++) {
      const alpha = i < this.lives ? 1 : 0.18;
      ctx.globalAlpha = alpha;
      ctx.fillText('❤️', 6 + i * (sz + 4), 6);
    }
    ctx.restore();
  }

  _emitStats() {
    const hearts = '❤️'.repeat(this.lives) + (LIVES_START - this.lives > 0 ? '🖤'.repeat(LIVES_START - this.lives) : '');
    this.emit('stats', `${hearts} &nbsp;·&nbsp; <b>${this.score}</b> pkt`);
  }
}
