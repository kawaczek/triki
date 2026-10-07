// games/lander/game.js — Lądownik Księżycowy
// Fizyka grawitacyjna:
// - Przechyl kapslem (tilt, GX) = obrót lądownika
// - Przycisk kapsla / klik = odpalenie głównego silnika rakietowego
// Cel: miękkie lądowanie na platformie (niska prędkość pionowa i pozioma, kąt bliski zeru)

import Sound from '../../static/sound.js';
import { clamp, rand, radialGlow } from '../../static/gameutils.js';

export default class LunarLander {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.triki = triki;
    this.emit = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;

    this.x = 0.5;
    this.y = 0.2;
    this.vx = 0;
    this.vy = 0;
    this.angle = 0; // w radianach
    this.fuel = 1000;
    this.thrusting = false;
    this.score = 0;
    this.landings = 0;

    this.terrain = [];
    this.padX = 0.5;
    this.padW = 0.16;
    this.padY = 0.85;

    this.particles = [];
    this.stars = [];
    this.shake = 0;
  }

  start(player) {
    this.player = player;
    this.x = 0.2 + Math.random() * 0.6;
    this.y = 0.15;
    this.vx = (Math.random() - 0.5) * 0.1;
    this.vy = 0;
    this.angle = 0;
    this.fuel = 1000;
    this.thrusting = false;
    this.score = 0;
    this.landings = 0;
    this.particles = [];
    this.generateStars();
    this.generateTerrain();
    this.running = true;
    this.emitStats();
  }

  resize(W, H) {
    this.W = W;
    this.H = H;
    this.generateStars();
  }

  generateStars() {
    this.stars = [];
    for (let i = 0; i < 70; i++) {
      this.stars.push({
        x: Math.random(),
        y: Math.random(),
        size: Math.random() * 2 + 0.5,
        alpha: Math.random() * 0.8 + 0.2
      });
    }
  }

  generateTerrain() {
    this.padX = 0.25 + Math.random() * 0.5;
    this.padW = 0.18;
    this.padY = 0.82;

    this.terrain = [];
    const points = 16;
    for (let i = 0; i <= points; i++) {
      const nx = i / points;
      let ny = 0.75 + Math.sin(i * 1.3) * 0.12 + Math.random() * 0.05;
      // wypłaszczenie terenu na lądowisko
      if (Math.abs(nx - this.padX) < this.padW / 2 + 0.03) {
        ny = this.padY;
      }
      this.terrain.push({ x: nx, y: ny });
    }
  }

  emitStats() {
    const spd = Math.round(Math.hypot(this.vx, this.vy) * 100);
    const fuelInt = Math.max(0, Math.round(this.fuel));
    this.emit('stats', `⛽ Paliwo: <b>${fuelInt}</b> &nbsp;|&nbsp; ⚡ Prędkość: <b>${spd}</b> &nbsp;|&nbsp; 🏆 Lądowania: <b>${this.landings}</b>`);
  }

  onMouseMove() {}
  onClick() {
    this.pulseThrust();
  }

  onKeyDown(code) {
    if (code === 'Space') this.pulseThrust();
  }

  pulseThrust() {
    if (this.fuel > 0) {
      this.thrusting = true;
      setTimeout(() => { this.thrusting = false; }, 180);
    }
  }

  update(dt) {
    if (!this.running) return;
    const dtSec = Math.min(dt / 1000, 0.1);

    // Kąt obrotu z kapsla (tilt w lewo/prawo)
    let rotInput = 0;
    if (this.triki?.connected) {
      // tilt poziomy
      const tiltX = this.triki.GZ ? -this.triki.GZ() : 0;
      rotInput = tiltX / 15;
      if (this.triki._btn && this.fuel > 0) {
        this.thrusting = true;
      } else {
        this.thrusting = false;
      }
    }

    this.angle = clamp(this.angle + rotInput * dtSec * 1.5, -Math.PI / 2.2, Math.PI / 2.2);

    // Grawitacja księżycowa (niska, 0.18 m/s^2)
    const gravity = 0.15;
    this.vy += gravity * dtSec;

    // Ciąg silnika
    if (this.thrusting && this.fuel > 0) {
      const thrustPower = 0.42;
      this.vx += Math.sin(this.angle) * thrustPower * dtSec;
      this.vy -= Math.cos(this.angle) * thrustPower * dtSec;
      this.fuel = Math.max(0, this.fuel - dtSec * 160);

      if (Math.random() < 0.4) Sound.play('tick');

      // Cząsteczki ognia z dyszy silnika
      for (let k = 0; k < 3; k++) {
        const exhaustAngle = this.angle + Math.PI + (Math.random() - 0.5) * 0.4;
        this.particles.push({
          x: this.x - Math.sin(this.angle) * 0.03,
          y: this.y + Math.cos(this.angle) * 0.03,
          vx: Math.sin(exhaustAngle) * (0.3 + Math.random() * 0.2),
          vy: Math.cos(exhaustAngle) * (0.3 + Math.random() * 0.2),
          life: 0.35,
          maxLife: 0.35,
          color: Math.random() > 0.5 ? '#f59e0b' : '#ef4444'
        });
      }
    }

    // Aktualizacja pozycji lądownika
    this.x += this.vx * dtSec;
    this.y += this.vy * dtSec;

    // Zawracanie na krawędziach ekranu
    if (this.x < 0.05) { this.x = 0.05; this.vx = -this.vx * 0.5; }
    if (this.x > 0.95) { this.x = 0.95; this.vx = -this.vx * 0.5; }

    // Sprawdzenie lądowania / zderzenia z powierzchnią
    const groundY = this.padY;
    if (this.y >= groundY - 0.03) {
      // Sprawdzamy czy lądujemy na platformie
      const onPad = Math.abs(this.x - this.padX) <= (this.padW / 2);
      const safeSpeed = Math.hypot(this.vx, this.vy) < 0.16;
      const safeAngle = Math.abs(this.angle) < 0.25; // kąt lądowania do ~15 stopni

      if (onPad && safeSpeed && safeAngle) {
        // PERFEKCYJNE LĄDOWANIE!
        Sound.play('win');
        this.landings++;
        const landingScore = Math.round(500 + this.fuel * 0.5 + (1 / (Math.hypot(this.vx, this.vy) + 0.01)) * 10);
        this.score += landingScore;
        this.y = groundY - 0.03;
        this.vx = 0;
        this.vy = 0;

        // Następna runda z nową platformą!
        setTimeout(() => {
          this.x = 0.1 + Math.random() * 0.8;
          this.y = 0.15;
          this.vx = (Math.random() - 0.5) * 0.1;
          this.vy = 0;
          this.angle = 0;
          this.fuel = Math.min(1000, this.fuel + 400);
          this.generateTerrain();
        }, 1200);
      } else {
        // ROZBICIE LĄDOWNIKA (CRASH)
        Sound.play('boom');
        this.shake = 0.6;
        this.running = false;

        // Iskry wybuchu
        for (let k = 0; k < 30; k++) {
          this.particles.push({
            x: this.x,
            y: this.y,
            vx: (Math.random() - 0.5) * 0.6,
            vy: (Math.random() - 0.5) * 0.6,
            life: 0.6,
            maxLife: 0.6,
            color: '#ef4444'
          });
        }

        setTimeout(() => {
          this.emit('end', { score: this.score });
        }, 1000);
        return;
      }
    }

    // Cząsteczki
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dtSec;
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      if (p.life <= 0) this.particles.splice(i, 1);
    }

    if (this.shake > 0) this.shake = Math.max(0, this.shake - dtSec * 2);

    this.emitStats();
  }

  draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    ctx.save();
    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * this.shake * 20, (Math.random() - 0.5) * this.shake * 20);
    }

    // Kosmos (ciemne tło)
    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, W, H);

    // Gwiazdy
    for (const s of this.stars) {
      ctx.fillStyle = `rgba(255,255,255,${s.alpha})`;
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // Ziemia w oddali
    ctx.fillStyle = '#0284c7';
    ctx.beginPath();
    ctx.arc(W * 0.85, H * 0.18, W * 0.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.arc(W * 0.86, H * 0.17, W * 0.03, 0, Math.PI * 2);
    ctx.fill();

    // Teren księżycowy
    ctx.fillStyle = '#374151';
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (const pt of this.terrain) {
      ctx.lineTo(pt.x * W, pt.y * H);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();

    // Platforma do lądowania (neonowo-zielona z napisem)
    const px = (this.padX - this.padW / 2) * W;
    const pw = this.padW * W;
    const py = this.padY * H;
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(px, py, pw, 6);
    ctx.fillStyle = 'rgba(34,197,94,0.3)';
    ctx.fillRect(px, py + 6, pw, 12);
    // Znaczniki platformy
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(px, py, pw, 6);

    // Cząsteczki silnika
    for (const p of this.particles) {
      const alpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(p.x * W, p.y * H, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Rysowanie Lądownika
    const lx = this.x * W;
    const ly = this.y * H;
    const lSize = W * 0.055;

    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(this.angle);

    // Nóżki lądownika
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-lSize * 0.5, lSize * 0.2);
    ctx.lineTo(-lSize * 0.8, lSize * 0.7);
    ctx.moveTo(lSize * 0.5, lSize * 0.2);
    ctx.lineTo(lSize * 0.8, lSize * 0.7);
    ctx.stroke();

    // Stópki
    ctx.fillStyle = '#d1d5db';
    ctx.fillRect(-lSize * 0.95, lSize * 0.65, lSize * 0.3, 3);
    ctx.fillRect(lSize * 0.65, lSize * 0.65, lSize * 0.3, 3);

    // Kadłub (złoty / żółty moduł lądowania)
    ctx.fillStyle = '#eab308';
    ctx.fillRect(-lSize * 0.6, -lSize * 0.2, lSize * 1.2, lSize * 0.6);

    // Kapsuła załogi (kopuła na górze)
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(0, -lSize * 0.25, lSize * 0.45, Math.PI, 0);
    ctx.fill();

    // Okno kokpitu
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(0, -lSize * 0.3, lSize * 0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
    ctx.restore();
  }

  drawIdle() {
    this.draw();
  }

  destroy() {
    this.running = false;
  }
}
