// games/asteroidy/game.js — Asteroidy
// Klasyczne wektorowe Asteroidy. Obrót kapsla = kierunek statku, GX < -15 = napęd, klik = strzał.

import { clamp, rand, radialGlow } from '../../static/gameutils.js';

const TWO_PI = Math.PI * 2;

// ── Pomocnicze funkcje geometryczne ─────────────────────────

function wrapPos(v, max) {
  if (v < 0) return v + max;
  if (v > max) return v - max;
  return v;
}

function circlesOverlap(ax, ay, ar, bx, by, br) {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy < (ar + br) * (ar + br);
}

// Generuje nieregularny wielokąt asteroidy (promień = r, punkty 8–12)
function makeAsteroidShape(r) {
  const pts = 9 + Math.floor(Math.random() * 4);
  const verts = [];
  for (let i = 0; i < pts; i++) {
    const a = (i / pts) * TWO_PI;
    const d = r * (0.7 + Math.random() * 0.6);
    verts.push([Math.cos(a) * d, Math.sin(a) * d]);
  }
  return verts;
}

// ── Klasy pomocnicze ─────────────────────────────────────────

class Asteroid {
  constructor(x, y, size, vx, vy, va) {
    // size: 'large'=50, 'medium'=25, 'small'=12
    this.x = x; this.y = y;
    this.size = size;
    this.r = size === 'large' ? 50 : size === 'medium' ? 25 : 12;
    this.vx = vx; this.vy = vy;
    this.va = va; // prędkość kątowa obrotu
    this.angle = Math.random() * TWO_PI;
    this.shape = makeAsteroidShape(this.r);
    this.score = size === 'large' ? 20 : size === 'medium' ? 50 : 100;
    this.alive = true;
  }

  update(dt, W, H) {
    this.x = wrapPos(this.x + this.vx * dt, W);
    this.y = wrapPos(this.y + this.vy * dt, H);
    this.angle += this.va * dt;
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.beginPath();
    const [x0, y0] = this.shape[0];
    ctx.moveTo(x0, y0);
    for (let i = 1; i < this.shape.length; i++) {
      const [xi, yi] = this.shape[i];
      ctx.lineTo(xi, yi);
    }
    ctx.closePath();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}

class Bullet {
  constructor(x, y, angle) {
    this.x = x; this.y = y;
    this.vx = Math.cos(angle) * 0.4;
    this.vy = Math.sin(angle) * 0.4;
    this.life = 2000; // ms
    this.alive = true;
  }

  update(dt, W, H) {
    this.life -= dt;
    if (this.life <= 0) { this.alive = false; return; }
    this.x = wrapPos(this.x + this.vx * dt, W);
    this.y = wrapPos(this.y + this.vy * dt, H);
  }

  draw(ctx) {
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#aef';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 2.5, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }
}

class Explosion {
  constructor(x, y, r) {
    this.x = x; this.y = y;
    this.life = 600; this.maxLife = 600;
    // Generujemy linijki wybuchu
    const n = 8 + Math.floor(Math.random() * 6);
    this.lines = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TWO_PI;
      const len = rand(r * 0.4, r * 1.2);
      const spd = rand(0.04, 0.15);
      this.lines.push({ a, len, vlen: spd, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, ox: 0, oy: 0 });
    }
  }

  update(dt) {
    this.life -= dt;
    this.lines.forEach(l => { l.ox += l.vx * dt; l.oy += l.vy * dt; });
  }

  draw(ctx) {
    const alpha = this.life / this.maxLife;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#aef';
    ctx.shadowBlur = 4;
    this.lines.forEach(l => {
      const ex = this.x + l.ox + Math.cos(l.a) * l.len * (1 - alpha);
      const ey = this.y + l.oy + Math.sin(l.a) * l.len * (1 - alpha);
      ctx.beginPath();
      ctx.moveTo(this.x + l.ox, this.y + l.oy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    });
    ctx.restore();
  }

  get alive() { return this.life > 0; }
}

// ── Gra główna ───────────────────────────────────────────────

export default class AsteroidyGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.triki = triki;
    this.emit = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;

    // Cały stan gry inicjalizowany w konstruktorze:
    this.score = 0;
    this.lives = 3;
    this.wave = 1;
    this.angle = -Math.PI / 2; // startujemy w górę
    this.px = 0; this.py = 0;
    this.vx = 0; this.vy = 0;
    this.thrusting = false;
    this.shieldTimer = 0;
    this.bullets = [];
    this.asteroids = [];
    this.explosions = [];
    this.stars = this._makeStars(60);
    this._shotCooldown = 0;
    this._gameOver = false;

    // Dla trybu idle (przed startem)
    this._idleAsteroids = this._spawnWave(3, 400, 300);
  }

  _makeStars(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push({ x: Math.random(), y: Math.random(), r: rand(0.5, 1.8), a: rand(0.3, 0.9) });
    }
    return out;
  }

  _spawnWave(count, W, H) {
    const asteroids = [];
    for (let i = 0; i < count; i++) {
      // Asteroidy startują z losowej krawędzi, dalej od środka
      let x, y;
      const edge = Math.floor(Math.random() * 4);
      if (edge === 0) { x = Math.random() * W; y = -60; }
      else if (edge === 1) { x = W + 60; y = Math.random() * H; }
      else if (edge === 2) { x = Math.random() * W; y = H + 60; }
      else { x = -60; y = Math.random() * H; }

      const speed = rand(0.02, 0.06) * (1 + this.wave * 0.05);
      const a = Math.random() * TWO_PI;
      const va = rand(-0.001, 0.001);
      asteroids.push(new Asteroid(x, y, 'large', Math.cos(a) * speed, Math.sin(a) * speed, va));
    }
    return asteroids;
  }

  start(player) {
    this.player = player;
    this.score = 0;
    this.lives = 3;
    this.wave = 1;
    this.angle = -Math.PI / 2;
    this.px = this.W / 2;
    this.py = this.H / 2;
    this.vx = 0; this.vy = 0;
    this.thrusting = false;
    this.shieldTimer = 3000;
    this.bullets = [];
    this.explosions = [];
    this._shotCooldown = 0;
    this._gameOver = false;
    this.asteroids = this._spawnWave(4, this.W, this.H);
    this.running = true;
    this._emitStats();
  }

  resize(W, H) {
    this.W = W; this.H = H;
    this.px = clamp(this.px, 0, W);
    this.py = clamp(this.py, 0, H);
  }

  _shoot() {
    if (this._shotCooldown > 0 || !this.running || this._gameOver) return;
    this._shotCooldown = 250;
    this.bullets.push(new Bullet(this.px, this.py, this.angle));
  }

  update(dt) {
    if (!this.running) return;
    if (this._gameOver) return;

    // ── Sterowanie BLE ────────────────────────────────────────
    if (this.triki.connected) {
      // ROT() — obrót kapsla w °/s; skalujemy do zmiany kąta
      this.angle += this.triki.ROT() * 0.002 * dt;
      // GX() — pochylenie przód/tył; GX < -15 = napęd
      this.thrusting = this.triki.GX() < -15;
      if (this.triki.consumeClick()) this._shoot();
    }

    // ── Cooldown strzału ──────────────────────────────────────
    if (this._shotCooldown > 0) this._shotCooldown -= dt;

    // ── Tarcza ochronna ───────────────────────────────────────
    if (this.shieldTimer > 0) this.shieldTimer -= dt;

    // ── Napęd ─────────────────────────────────────────────────
    if (this.thrusting) {
      const thrust = 0.00025;
      this.vx += Math.cos(this.angle) * thrust * dt;
      this.vy += Math.sin(this.angle) * thrust * dt;
    }
    // Tarcie (drag) — prędkość maleje z czasem
    const drag = Math.pow(0.99, dt / 16.67);
    this.vx *= drag;
    this.vy *= drag;

    // ── Ruch statku (wrap-around) ─────────────────────────────
    this.px = wrapPos(this.px + this.vx * dt, this.W);
    this.py = wrapPos(this.py + this.vy * dt, this.H);

    // ── Pociski ───────────────────────────────────────────────
    this.bullets.forEach(b => b.update(dt, this.W, this.H));
    this.bullets = this.bullets.filter(b => b.alive);

    // ── Asteroidy ─────────────────────────────────────────────
    this.asteroids.forEach(a => a.update(dt, this.W, this.H));

    // ── Kolizje pocisk → asteroida ────────────────────────────
    const newAsteroids = [];
    for (let ai = this.asteroids.length - 1; ai >= 0; ai--) {
      const ast = this.asteroids[ai];
      if (!ast.alive) continue;
      let hit = false;
      for (let bi = this.bullets.length - 1; bi >= 0; bi--) {
        const b = this.bullets[bi];
        if (!b.alive) continue;
        if (circlesOverlap(b.x, b.y, 4, ast.x, ast.y, ast.r)) {
          b.alive = false;
          ast.alive = false;
          hit = true;
          this.score += ast.score;
          this.explosions.push(new Explosion(ast.x, ast.y, ast.r));
          // Rozbicie asteroidy
          if (ast.size === 'large') {
            for (let k = 0; k < 2; k++) {
              const a2 = Math.random() * TWO_PI;
              const spd = rand(0.04, 0.09);
              newAsteroids.push(new Asteroid(ast.x + rand(-15, 15), ast.y + rand(-15, 15),
                'medium', Math.cos(a2) * spd, Math.sin(a2) * spd, rand(-0.002, 0.002)));
            }
          } else if (ast.size === 'medium') {
            for (let k = 0; k < 2; k++) {
              const a2 = Math.random() * TWO_PI;
              const spd = rand(0.07, 0.14);
              newAsteroids.push(new Asteroid(ast.x + rand(-8, 8), ast.y + rand(-8, 8),
                'small', Math.cos(a2) * spd, Math.sin(a2) * spd, rand(-0.003, 0.003)));
            }
          }
          // 'small' znika bez rozbicia
          this._emitStats();
          break;
        }
      }
    }
    this.asteroids = this.asteroids.filter(a => a.alive);
    this.asteroids.push(...newAsteroids);

    // ── Kolizja statek → asteroida ────────────────────────────
    if (this.shieldTimer <= 0) {
      for (const ast of this.asteroids) {
        if (circlesOverlap(this.px, this.py, 10, ast.x, ast.y, ast.r)) {
          this.lives--;
          this.explosions.push(new Explosion(this.px, this.py, 20));
          this.shieldTimer = 3000;
          this._emitStats();
          if (this.lives <= 0) {
            this._gameOver = true;
            this.running = false;
            this.emit('end', { score: this.score });
          }
          break;
        }
      }
    }

    // ── Wybuchy ───────────────────────────────────────────────
    this.explosions.forEach(e => e.update(dt));
    this.explosions = this.explosions.filter(e => e.alive);

    // ── Nowa fala ─────────────────────────────────────────────
    if (this.asteroids.length === 0) {
      this.wave++;
      const count = 4 + (this.wave - 1);
      this.asteroids = this._spawnWave(count, this.W, this.H);
      this._emitStats();
    }
  }

  draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    // Tło: czarne z gwiazdami
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    this._drawStars(ctx, W, H);

    // Wybuchy
    this.explosions.forEach(e => e.draw(ctx));

    // Asteroidy
    this.asteroids.forEach(a => a.draw(ctx));

    // Pociski
    this.bullets.forEach(b => b.draw(ctx));

    // Statek (tylko gdy gra aktywna)
    if (this.running || !this._gameOver) {
      this._drawShip(ctx);
    }

    // HUD
    this._drawHUD(ctx, W, H);
  }

  _drawStars(ctx, W, H) {
    ctx.save();
    this.stars.forEach(s => {
      ctx.globalAlpha = s.a;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, TWO_PI);
      ctx.fill();
    });
    ctx.restore();
  }

  _drawShip(ctx) {
    const blink = this.shieldTimer > 0 && Math.floor(this.shieldTimer / 150) % 2 === 0;
    if (blink) return;

    ctx.save();
    ctx.translate(this.px, this.py);
    ctx.rotate(this.angle + Math.PI / 2); // statek celuje w prawo domyślnie, obracamy by celował w górę

    // Tarcza ochronna
    if (this.shieldTimer > 0) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#88f';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#88f';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, TWO_PI);
      ctx.stroke();
      ctx.restore();
    }

    // Płomień napędu
    if (this.thrusting) {
      ctx.save();
      ctx.strokeStyle = '#f80';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#fa0';
      ctx.shadowBlur = 10;
      ctx.globalAlpha = 0.7 + Math.random() * 0.3;
      ctx.beginPath();
      ctx.moveTo(-5, 8);
      ctx.lineTo(0, 16 + Math.random() * 8);
      ctx.lineTo(5, 8);
      ctx.stroke();
      ctx.restore();
    }

    // Kadłub — trójkąt wektorowy
    ctx.beginPath();
    ctx.moveTo(0, -14);    // dziób
    ctx.lineTo(-9, 10);    // lewy tył
    ctx.lineTo(-3, 5);     // wcięcie lewe
    ctx.lineTo(0, 8);      // ogon
    ctx.lineTo(3, 5);      // wcięcie prawe
    ctx.lineTo(9, 10);     // prawy tył
    ctx.closePath();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#aef';
    ctx.shadowBlur = 8;
    ctx.stroke();

    ctx.restore();
  }

  _drawHUD(ctx, W, H) {
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(W / 18)}px monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.shadowColor = '#aef';
    ctx.shadowBlur = 6;
    ctx.fillText(`${this.score}`, 14, 12);

    // Życia — małe statki
    ctx.textAlign = 'right';
    for (let i = 0; i < this.lives; i++) {
      ctx.save();
      const lx = W - 18 - i * 22;
      const ly = 16;
      ctx.translate(lx, ly);
      ctx.rotate(-Math.PI / 2);
      ctx.scale(0.6, 0.6);
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.lineTo(-9, 10);
      ctx.lineTo(0, 5);
      ctx.lineTo(9, 10);
      ctx.closePath();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    // Poziom (fala)
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.65;
    ctx.font = `${Math.round(W / 26)}px monospace`;
    ctx.fillText(`FALA ${this.wave}`, W / 2, 12);

    ctx.restore();
  }

  drawIdle() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    this._drawStars(ctx, W, H);
    // Animacja idleAsteroid (statyczne — nie update'ujemy)
    this._idleAsteroids.forEach(a => a.draw(ctx));
    // Napis
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = `bold ${Math.round(W / 9)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#aef';
    ctx.shadowBlur = 18;
    ctx.fillText('ASTEROIDY', W / 2, H / 2);
    ctx.restore();
  }

  destroy() { this.running = false; }

  _emitStats() {
    let hearts = '';
    for (let i = 0; i < 3; i++) hearts += i < this.lives ? '❤️' : '🖤';
    this.emit('stats',
      `${hearts} &nbsp;·&nbsp; 🌊 Fala <b>${this.wave}</b> &nbsp;·&nbsp; 🏆 <b>${this.score}</b>`);
  }
}
