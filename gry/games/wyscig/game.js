// games/wyscig/game.js — Triki Drift
// Sterowanie kapslem: obrót kapsla (scheme: rotate, triki.ROT()) = kierownica bolidu!
// Przycisk kapsla = NITRO!

import Sound from '../../static/sound.js';
import { clamp, rand, radialGlow } from '../../static/gameutils.js';

export default class TrikiDrift {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.triki = triki;
    this.emit = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;

    this.carX = 0.5;
    this.carSpeed = 0;
    this.baseSpeed = 0.45;
    this.nitro = 100;
    this.isNitro = false;
    this.distance = 0;
    this.score = 0;
    this.lives = 3;

    this.roadCurvature = 0;
    this.roadOffset = 0;
    this.obstacles = []; // { x, y, type: 'car'|'oil'|'coin', speed }
    this.particles = []; // ślady opon, ogień z nitro, iskry
    this.shake = 0;
    this.t = 0;
  }

  start(player) {
    this.player = player;
    this.carX = 0.5;
    this.carSpeed = this.baseSpeed;
    this.nitro = 100;
    this.isNitro = false;
    this.distance = 0;
    this.score = 0;
    this.lives = 3;
    this.obstacles = [];
    this.particles = [];
    this.shake = 0;
    this.t = 0;
    this.running = true;
    Sound.play('woosh');
    this.emitStats();
  }

  resize(W, H) {
    this.W = W;
    this.H = H;
  }

  emitStats() {
    const nitroPct = Math.round(this.nitro);
    const hearts = '❤️'.repeat(Math.max(0, this.lives));
    this.emit('stats', `${hearts} &nbsp;|&nbsp; 🏁 <b>${Math.floor(this.score)}</b> m &nbsp;|&nbsp; ⚡ <b>${nitroPct}%</b>`);
  }

  onMouseMove(nx) {
    this.carX = nx;
  }

  onClick() {
    this.toggleNitro();
  }

  onKeyDown(code) {
    if (code === 'Space') this.toggleNitro();
  }

  toggleNitro() {
    if (this.nitro > 15) {
      this.isNitro = true;
      Sound.play('laser');
    }
  }

  update(dt) {
    if (!this.running) return;
    const dtSec = Math.min(dt / 1000, 0.1);
    this.t += dtSec;

    // Sterowanie żyroskopem — kręcenie kapslem jak kierownicą!
    let steer = 0;
    if (this.triki?.connected) {
      // triki.ROT() zwraca prędkość kątową obrotu wokół osi Z
      const rot = this.triki.ROT?.() ?? 0;
      steer = (rot / 45); // czułość kierownicy
      
      // Przycisk kapsla aktywuje nitro
      if (this.triki._btn) {
        if (this.nitro > 0) this.isNitro = true;
      } else {
        this.isNitro = false;
      }
    } else {
      if (this.isNitro && this.nitro <= 0) this.isNitro = false;
    }

    // Nitro zużycie i regeneracja
    if (this.isNitro && this.nitro > 0) {
      this.nitro = Math.max(0, this.nitro - dtSec * 35);
      this.carSpeed = this.baseSpeed * 1.7;
      if (Math.random() < 0.4) {
        Sound.play('tick');
      }
      // Płomienie z rury wydechowej
      this.particles.push({
        x: this.carX + (Math.random() - 0.5) * 0.04,
        y: 0.88,
        vx: (Math.random() - 0.5) * 0.1,
        vy: 0.8 + Math.random() * 0.4,
        life: 0.25,
        maxLife: 0.25,
        color: Math.random() > 0.5 ? '#f59e0b' : '#ef4444',
        r: 6
      });
    } else {
      this.isNitro = false;
      this.nitro = Math.min(100, this.nitro + dtSec * 12);
      this.carSpeed = this.baseSpeed;
    }

    // Ruch bolidu w poziomie
    this.carX = clamp(this.carX + steer * dtSec * 1.2, 0.15, 0.85);

    // Dystans i wynik
    this.distance += this.carSpeed * dtSec * 100;
    this.score = this.distance;

    // Zakręty drogi
    this.roadCurvature = Math.sin(this.t * 0.4) * 0.15;
    this.roadOffset = (this.roadOffset + this.carSpeed * dtSec * 4) % 1;

    // Generowanie przeszkód (inne auta, plamy oleju, żetony paliwa)
    if (Math.random() < dtSec * 1.8) {
      const types = ['car', 'car', 'coin', 'oil'];
      const type = types[Math.floor(Math.random() * types.length)];
      this.obstacles.push({
        x: 0.2 + Math.random() * 0.6,
        y: -0.1,
        type: type,
        speed: type === 'car' ? 0.15 + Math.random() * 0.1 : 0
      });
    }

    // Ślady opon (drift)
    if (Math.abs(steer) > 0.6 || this.isNitro) {
      this.particles.push({
        x: this.carX - 0.025,
        y: 0.85,
        vx: 0,
        vy: this.carSpeed * 1.5,
        life: 0.4,
        maxLife: 0.4,
        color: 'rgba(20,20,25,0.4)',
        r: 4
      });
      this.particles.push({
        x: this.carX + 0.025,
        y: 0.85,
        vx: 0,
        vy: this.carSpeed * 1.5,
        life: 0.4,
        maxLife: 0.4,
        color: 'rgba(20,20,25,0.4)',
        r: 4
      });
    }

    // Aktualizacja przeszkód i kolizje
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const o = this.obstacles[i];
      // przeszkody zbliżają się w stronę kamery
      o.y += (this.carSpeed - o.speed) * dtSec * 2.5;

      // Sprawdzenie kolizji z graczem
      const dx = Math.abs(o.x - this.carX);
      const dy = Math.abs(o.y - 0.82);

      if (dx < 0.07 && dy < 0.06) {
        if (o.type === 'coin') {
          // Zebranie nitro / monety
          this.nitro = Math.min(100, this.nitro + 25);
          this.score += 50;
          Sound.play('coin');
          this.obstacles.splice(i, 1);
          continue;
        } else if (o.type === 'oil') {
          // Poślizg na plamie oleju
          this.carX = clamp(this.carX + (Math.random() > 0.5 ? 0.12 : -0.12), 0.15, 0.85);
          this.shake = 0.3;
          Sound.play('woosh');
          this.obstacles.splice(i, 1);
          continue;
        } else if (o.type === 'car') {
          // Zderzenie z innym pojazdem
          Sound.play('boom');
          this.shake = 0.5;
          this.lives--;
          this.obstacles.splice(i, 1);

          // Iskry
          for (let k = 0; k < 15; k++) {
            this.particles.push({
              x: this.carX,
              y: 0.82,
              vx: (Math.random() - 0.5) * 0.8,
              vy: (Math.random() - 0.5) * 0.8,
              life: 0.4,
              maxLife: 0.4,
              color: '#ef4444',
              r: 3
            });
          }

          if (this.lives <= 0) {
            this.running = false;
            Sound.play('fail');
            this.emit('end', { score: Math.floor(this.score) });
            return;
          }
          continue;
        }
      }

      if (o.y > 1.2) {
        this.obstacles.splice(i, 1);
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

    // Trawa po bokach
    ctx.fillStyle = '#064e3b';
    ctx.fillRect(0, 0, W, H);

    // Droga (asfalt z perspektywą)
    const roadLeft = W * 0.12;
    const roadRight = W * 0.88;
    const roadW = roadRight - roadLeft;

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(roadLeft, 0, roadW, H);

    // Pobocza (czerwono-białe tarki krawężnika)
    const curbW = W * 0.025;
    const stripeCount = 20;
    const stripeH = H / stripeCount;
    for (let i = -1; i < stripeCount + 1; i++) {
      const y = (i + this.roadOffset) * stripeH;
      const isRed = Math.floor(i + this.roadOffset * 2) % 2 === 0;
      ctx.fillStyle = isRed ? '#ef4444' : '#f8fafc';
      ctx.fillRect(roadLeft - curbW, y, curbW, stripeH);
      ctx.fillRect(roadRight, y, curbW, stripeH);
    }

    // Pasy środkowe jezdni
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 4;
    ctx.setLineDash([stripeH * 0.6, stripeH * 0.4]);
    ctx.lineDashOffset = -this.roadOffset * stripeH;
    ctx.beginPath();
    ctx.moveTo(W * 0.38, 0); ctx.lineTo(W * 0.38, H);
    ctx.moveTo(W * 0.62, 0); ctx.lineTo(W * 0.62, H);
    ctx.stroke();
    ctx.setLineDash([]);

    // Cząsteczki (ślady opon)
    for (const p of this.particles) {
      const alpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(p.x * W, p.y * H, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Rysowanie przeszkód
    for (const o of this.obstacles) {
      const ox = o.x * W;
      const oy = o.y * H;

      if (o.type === 'coin') {
        // Piorun NITRO
        ctx.fillStyle = '#fbbf24';
        ctx.shadowColor = '#f59e0b';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(ox, oy, W * 0.03, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#000';
        ctx.font = `bold ${Math.round(W * 0.035)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⚡', ox, oy);
      } else if (o.type === 'oil') {
        // Plama oleju
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.beginPath();
        ctx.ellipse(ox, oy, W * 0.045, W * 0.025, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (o.type === 'car') {
        // Auto cywilne (czerwone/niebieskie)
        const carW = W * 0.07;
        const carH = H * 0.08;
        ctx.fillStyle = '#ef4444';
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.roundRect(ox - carW / 2, oy - carH / 2, carW, carH, 6);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Szyby
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(ox - carW * 0.35, oy - carH * 0.2, carW * 0.7, carH * 0.4);
        // Światła tylne
        ctx.fillStyle = '#f87171';
        ctx.fillRect(ox - carW * 0.4, oy + carH * 0.35, carW * 0.2, carH * 0.1);
        ctx.fillRect(ox + carW * 0.2, oy + carH * 0.35, carW * 0.2, carH * 0.1);
      }
    }

    // Bolid Gracza (zielona żaba wyścigowa)
    const gx = this.carX * W;
    const gy = 0.82 * H;
    const bw = W * 0.075;
    const bh = H * 0.085;

    // Cień bolidu
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(gx, gy + bh * 0.4, bw * 0.6, bh * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Kadłub bolidu
    ctx.fillStyle = this.isNitro ? '#38bdf8' : '#22c55e';
    ctx.shadowColor = this.isNitro ? '#0284c7' : '#15803d';
    ctx.shadowBlur = this.isNitro ? 16 : 8;
    ctx.beginPath();
    ctx.roundRect(gx - bw / 2, gy - bh / 2, bw, bh, 8);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Spojler
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(gx - bw * 0.6, gy + bh * 0.3, bw * 1.2, bh * 0.12);

    // Koła bolidu
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(gx - bw * 0.6, gy - bh * 0.4, bw * 0.15, bh * 0.25);
    ctx.fillRect(gx + bw * 0.45, gy - bh * 0.4, bw * 0.15, bh * 0.25);
    ctx.fillRect(gx - bw * 0.6, gy + bh * 0.1, bw * 0.15, bh * 0.25);
    ctx.fillRect(gx + bw * 0.45, gy + bh * 0.1, bw * 0.15, bh * 0.25);

    // Kokpit
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(gx - bw * 0.3, gy - bh * 0.2, bw * 0.6, bh * 0.35);

    ctx.restore();
  }

  drawIdle() {
    this.draw();
  }

  destroy() {
    this.running = false;
  }
}
