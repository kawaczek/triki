// games/wedkarz/game.js — Młody Wędkarz
// Sterowanie:
// 1. Zarzut wędki: Przycisk kapsla / klik
// 2. Branie: spławik drga, woda pluska
// 3. Zacięcie: Przycisk w odpowiednim momencie!
// 4. Holowanie: Kręcenie kapslem jak kołowrotkiem (scheme: rotate, triki.ROT())! Pilnuj naprężenia żyłki!

import Sound from '../../static/sound.js';
import { clamp, rand, radialGlow } from '../../static/gameutils.js';

const FISH_TYPES = [
  { name: 'Płotka', weightMin: 80, weightMax: 300, color: '#94a3b8', difficulty: 1, emoji: '🐟' },
  { name: 'Okoń Pasiasty', weightMin: 350, weightMax: 950, color: '#16a34a', difficulty: 1.5, emoji: '🐠' },
  { name: 'Szczupak Król Jeziora', weightMin: 1200, weightMax: 3800, color: '#0d9488', difficulty: 2.2, emoji: '🦈' },
  { name: 'Sum Żabkowy Gigant', weightMin: 4500, weightMax: 12000, color: '#d97706', difficulty: 3.0, emoji: '🐋' }
];

export default class Wedkarz {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.triki = triki;
    this.emit = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;

    this.state = 'idle'; // 'idle' | 'waiting' | 'bite' | 'reeling' | 'caught'
    this.totalWeight = 0;
    this.catchesCount = 0;
    this.bobberX = 0.5;
    this.bobberY = 0.65;
    this.bobberBob = 0;

    this.biteTimer = 0;
    this.biteWindow = 0;
    this.currentFish = null;
    this.fishWeight = 0;
    this.fishProgress = 0; // 0..100 (100 = ryba na brzegu)
    this.lineTension = 0.5; // 0..1 (za dużo = zerwana, za mało = ucieczka)
    this.fishStruggle = 0;

    this.ripples = [];
    this.particles = [];
    this.t = 0;
  }

  start(player) {
    this.player = player;
    this.totalWeight = 0;
    this.catchesCount = 0;
    this.state = 'idle';
    this.ripples = [];
    this.particles = [];
    this.t = 0;
    this.running = true;
    this.emitStats();
  }

  resize(W, H) {
    this.W = W;
    this.H = H;
  }

  emitStats() {
    this.emit('stats', `🎣 Złowione: <b>${this.catchesCount}</b> &nbsp;|&nbsp; ⚖️ Łączna waga: <b>${this.totalWeight}</b> g`);
  }

  onMouseMove(nx, ny) {}
  onClick() {
    this.handleAction();
  }

  onKeyDown(code) {
    if (code === 'Space') this.handleAction();
  }

  handleAction() {
    if (this.state === 'idle') {
      // Zarzut
      this.castRod();
    } else if (this.state === 'bite') {
      // Zacięcie!
      this.hookFish();
    } else if (this.state === 'waiting') {
      // Za wcześnie!
      Sound.play('fail');
      this.state = 'idle';
    } else if (this.state === 'caught') {
      // Gotowy na kolejny zarzut
      this.state = 'idle';
    }
  }

  castRod() {
    this.state = 'waiting';
    this.bobberX = 0.35 + Math.random() * 0.3;
    this.bobberY = 0.55 + Math.random() * 0.15;
    this.biteTimer = 2.0 + Math.random() * 3.5;
    Sound.play('woosh');
    this.addRipple(this.bobberX, this.bobberY);
  }

  hookFish() {
    // Sukces zacięcia!
    Sound.play('win');
    this.state = 'reeling';
    const pick = FISH_TYPES[Math.floor(Math.random() * FISH_TYPES.length)];
    this.currentFish = pick;
    this.fishWeight = Math.round(pick.weightMin + Math.random() * (pick.weightMax - pick.weightMin));
    this.fishProgress = 15;
    this.lineTension = 0.5;
    this.addRipple(this.bobberX, this.bobberY);
  }

  addRipple(x, y) {
    this.ripples.push({ x, y, r: 5, maxR: 40, alpha: 1.0 });
  }

  update(dt) {
    if (!this.running) return;
    const dtSec = Math.min(dt / 1000, 0.1);
    this.t += dtSec;

    // Przycisk kapsla
    if (this.triki?.consumeClick?.()) {
      this.handleAction();
    }

    // Aktualizacja fal na wodzie
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rip = this.ripples[i];
      rip.r += dtSec * 30;
      rip.alpha -= dtSec * 1.2;
      if (rip.alpha <= 0) this.ripples.splice(i, 1);
    }

    if (this.state === 'waiting') {
      this.bobberBob = Math.sin(this.t * 3) * 3;
      this.biteTimer -= dtSec;
      if (this.biteTimer <= 0) {
        this.state = 'bite';
        this.biteWindow = 1.2; // czas na zacięcie
        Sound.play('tick');
        this.addRipple(this.bobberX, this.bobberY);
      }
    } else if (this.state === 'bite') {
      this.bobberBob = Math.sin(this.t * 20) * 12; // mocne szarpanie spławika!
      this.biteWindow -= dtSec;
      if (Math.random() < 0.2) this.addRipple(this.bobberX, this.bobberY);

      if (this.biteWindow <= 0) {
        // Ryba uciekła z haczyka!
        Sound.play('fail');
        this.state = 'idle';
      }
    } else if (this.state === 'reeling') {
      // Holowanie ryby!
      // Obrót kapslem (kołowrotek)
      let reelSpeed = 0;
      if (this.triki?.connected) {
        const rot = Math.abs(this.triki.ROT?.() ?? 0);
        reelSpeed = rot / 30;
      } else {
        reelSpeed = 1.2; // fallback demo/mysz
      }

      // Szamotanie się ryby
      this.fishStruggle = Math.sin(this.t * 5 * this.currentFish.difficulty) * 0.5 + 0.5;
      
      // Naprężenie żyłki
      const reelPull = reelSpeed * dtSec * 0.8;
      const fishPull = this.fishStruggle * dtSec * 0.9 * this.currentFish.difficulty;

      this.lineTension = clamp(this.lineTension + reelPull - dtSec * 0.3 + (fishPull * 0.2), 0.1, 1.1);

      // Postęp holowania
      if (this.lineTension >= 0.3 && this.lineTension <= 0.85) {
        this.fishProgress += reelSpeed * dtSec * 14;
      } else if (this.lineTension < 0.3) {
        // Zbyt luźna żyłka — ryba odpływa!
        this.fishProgress -= dtSec * 8;
      }

      if (Math.random() < 0.3) this.addRipple(this.bobberX, this.bobberY);

      // Warunki porażki / zerwania
      if (this.lineTension >= 1.0) {
        Sound.play('boom');
        this.state = 'idle'; // żyłka pękła!
      } else if (this.fishProgress <= 0) {
        Sound.play('fail');
        this.state = 'idle'; // ryba zerwała się
      } else if (this.fishProgress >= 100) {
        // ZŁOWIONA!
        Sound.play('win');
        this.state = 'caught';
        this.totalWeight += this.fishWeight;
        this.catchesCount++;
        this.emitStats();

        // 5 złowionych ryb kończy sesję i zapisuje rekord!
        if (this.catchesCount >= 5) {
          setTimeout(() => {
            this.running = false;
            this.emit('end', { score: this.totalWeight });
          }, 1500);
        }
      }
    }
  }

  draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    // Niebo i góry w tle
    const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.45);
    skyGrad.addColorStop(0, '#0284c7');
    skyGrad.addColorStop(1, '#bae6fd');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H * 0.45);

    // Woda jeziora
    const waterGrad = ctx.createLinearGradient(0, H * 0.45, 0, H);
    waterGrad.addColorStop(0, '#0369a1');
    waterGrad.addColorStop(0.5, '#075985');
    waterGrad.addColorStop(1, '#0c4a6e');
    ctx.fillStyle = waterGrad;
    ctx.fillRect(0, H * 0.45, W, H * 0.55);

    // Fale na wodzie
    for (const rip of this.ripples) {
      ctx.strokeStyle = `rgba(255,255,255,${rip.alpha * 0.6})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(rip.x * W, rip.y * H, rip.r, rip.r * 0.35, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Pomost wędkarza (na dole)
    ctx.fillStyle = '#78350f';
    ctx.fillRect(W * 0.1, H * 0.88, W * 0.8, H * 0.12);
    // Deski
    ctx.strokeStyle = '#451a03';
    ctx.lineWidth = 3;
    for (let x = W * 0.15; x < W * 0.9; x += W * 0.1) {
      ctx.beginPath(); ctx.moveTo(x, H * 0.88); ctx.lineTo(x, H); ctx.stroke();
    }

    // Wędka
    const rodBaseX = W * 0.5;
    const rodBaseY = H * 0.92;
    const rodTipX = W * 0.55;
    const rodTipY = H * 0.48;

    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(rodBaseX, rodBaseY);
    ctx.quadraticCurveTo(W * 0.52, H * 0.65, rodTipX, rodTipY);
    ctx.stroke();

    // Żyłka
    if (this.state !== 'idle' && this.state !== 'caught') {
      const bx = this.bobberX * W;
      const by = this.bobberY * H + this.bobberBob;

      ctx.strokeStyle = this.state === 'reeling' && this.lineTension > 0.85 ? '#ef4444' : 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(rodTipX, rodTipY);
      ctx.lineTo(bx, by);
      ctx.stroke();

      // Spławik (czerwono-biały)
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(bx, by, 7, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(bx, by, 7, 0, Math.PI);
      ctx.fill();
      // Antenka
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx, by - 7);
      ctx.lineTo(bx, by - 14);
      ctx.stroke();
    }

    // Pasek holowania ryby
    if (this.state === 'reeling') {
      const barW = W * 0.65;
      const barH = 16;
      const barX = W * 0.175;
      const barY = H * 0.15;

      // Naprężenie żyłki
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(barX, barY, barW, barH);
      const tensionColor = this.lineTension > 0.85 ? '#ef4444' : this.lineTension < 0.3 ? '#f59e0b' : '#22c55e';
      ctx.fillStyle = tensionColor;
      ctx.fillRect(barX, barY, barW * clamp(this.lineTension, 0, 1), barH);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(barX, barY, barW, barH);

      // Etykieta
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px Outfit,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`NAPRĘŻENIE ŻYŁKI (KRĘĆ KAPSLEM!)`, W / 2, barY - 6);

      // Pasek postępu holowania (odległość do brzegu)
      const progY = barY + 30;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(barX, progY, barW, 10);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(barX, progY, barW * (this.fishProgress / 100), 10);
      ctx.strokeRect(barX, progY, barW, 10);
      ctx.fillText(`DO BRZEGU: ${Math.round(this.fishProgress)}%`, W / 2, progY + 24);
    }

    // Komunikat brania
    if (this.state === 'bite') {
      ctx.fillStyle = '#ef4444';
      ctx.font = '900 28px Outfit,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('❗ BIERZE! ZACINAJ! ❗', W / 2, H * 0.38);
    } else if (this.state === 'caught') {
      ctx.fillStyle = '#22c55e';
      ctx.font = '900 24px Outfit,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`🎉 ZŁOWIONO: ${this.currentFish.name}!`, W / 2, H * 0.35);
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 18px Outfit,sans-serif';
      ctx.fillText(`Waga: ${this.fishWeight} g ${this.currentFish.emoji}`, W / 2, H * 0.40);
      ctx.font = '13px Outfit,sans-serif';
      ctx.fillText(`Kliknij przycisk by zarzucić ponownie (${this.catchesCount}/5)`, W / 2, H * 0.45);
    } else if (this.state === 'idle') {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = 'bold 16px Outfit,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🔘 Wciśnij przycisk kapsla aby ZARZUCIĆ WĘDKĘ', W / 2, H * 0.35);
    }
  }

  drawIdle() {
    this.draw();
  }

  destroy() {
    this.running = false;
  }
}
