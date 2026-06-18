// games/wiezowiec/game.js — Wieżowiec (Tower Stacker)
// Klik/spacja/przycisk BLE = upuść poruszający się blok.
// Oblicz overlap z poprzednim piętrem → nowe piętro o szerokości overlap.
// Nadmiar odpada (animacja). Blok przyspiesza co 5 pięter.

import { clamp, radialGlow } from '../../static/gameutils.js';

const BASE_W_FRAC  = 0.6;    // szerokość startowa (fraction W)
const BASE_H_FRAC  = 0.05;   // wysokość piętra (fraction H)
const BASE_SPD     = 0.30;   // px/ms startowa prędkość bloku
const MAX_SPD      = 0.80;   // px/ms max
const SPD_INC      = 0.10;   // wzrost prędkości co 5 pięter
const SPD_LEVELS   = 5;      // co ile pięter rośnie prędkość
const MIN_W_FRAC   = 0.05;   // minimalna szerokość piętra (fraction W) — poniżej game over
const PERFECT_TOL  = 3;      // px tolerancja dla "PERFECT!"
const FALL_GRAVITY = 0.0018; // px/ms² — animacja opadania nadmiaru

// Tęczowe kolory pięter (HSL od dołu do góry)
function floorColor(idx) {
  const hue = (idx * 17 + 200) % 360;
  return `hsl(${hue},80%,55%)`;
}

export default class WiezowiecGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas  = canvas;
    this.ctx     = ctx;
    this.triki   = triki;
    this.emit    = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;
    this._initState();
  }

  _blockH() { return Math.max(18, Math.round(this.H * BASE_H_FRAC)); }

  _initState() {
    const W = this.W, H = this.H;
    const bh = this._blockH();

    // podstawa (piętro 0)
    this.floors = [{
      x: W / 2 - W * BASE_W_FRAC / 2,
      w: W * BASE_W_FRAC,
      // y = wirtualna wysokość, przeliczamy na ekran podczas rysowania
    }];
    this.score      = 0;         // liczba pięter (bez podstawy)
    this.scrollOff  = 0;         // offset w pikselach — jak wysoko przesuwa ekran

    // poruszający się blok
    this.movX   = W / 2 - W * BASE_W_FRAC / 2; // lewa krawędź
    this.movW   = W * BASE_W_FRAC;
    this.movDir = 1;   // 1 = w prawo, -1 = w lewo
    this.movSpd = BASE_SPD;

    // animacje odpadającego nadmiaru
    this._debris = [];  // {x, y, w, vy, t, color}

    // banner (PERFECT! / CHYBIŁ!)
    this._banner = null;
    this._gameOver = false;
  }

  _currentSpd() {
    const lvl = Math.floor(this.score / SPD_LEVELS);
    return clamp(BASE_SPD + lvl * SPD_INC, BASE_SPD, MAX_SPD);
  }

  // Y na ekranie dla piętra o indeksie idx (0 = podstawa u dołu)
  // scrollOff przesuwa widok w górę gdy wieża rośnie
  _floorScreenY(idx) {
    const bh = this._blockH();
    const baseY = this.H - bh;          // dolna krawędź ekranu
    return baseY - idx * (bh + 2) + this.scrollOff;
  }

  // Y poruszającego się bloku (zawsze nad szczytem wieży)
  _movScreenY() {
    const top = this.floors.length;     // indeks piętra, które będzie kładzione
    return this._floorScreenY(top) - 4; // lekko nad szczytem
  }

  start(player) {
    this.player = player;
    this._initState();
    this.running = true;
    this._emitStats();
  }

  resize(W, H) { this.W = W; this.H = H; }

  onMouseMove(nx, ny) {}
  onClick(nx, ny) { this._drop(); }
  onKeyDown(code) {
    if (code === 'Space' || code === 'ArrowDown' || code === 'Enter') this._drop();
  }

  update(dt) {
    if (!this.running) return;

    // BLE klik
    if (this.triki.consumeClick()) this._drop();

    // banner countdown
    if (this._banner) { this._banner.t -= dt; if (this._banner.t <= 0) this._banner = null; }

    // ruch poruszającego się bloku
    this.movX += this.movDir * this.movSpd * dt;

    // odbicie od krawędzi
    if (this.movX < 0) {
      this.movX = 0;
      this.movDir = 1;
    } else if (this.movX + this.movW > this.W) {
      this.movX = this.W - this.movW;
      this.movDir = -1;
    }

    // animacje debris
    this._debris = this._debris.filter(d => d.t > 0);
    for (const d of this._debris) {
      d.vy += FALL_GRAVITY * dt;
      d.y  += d.vy * dt;
      d.t  -= dt;
    }
  }

  _drop() {
    if (!this.running || this._gameOver) return;

    const top = this.floors[this.floors.length - 1]; // ostatnie piętro
    const bh  = this._blockH();

    // oblicz overlap
    const overlapL = Math.max(this.movX, top.x);
    const overlapR = Math.min(this.movX + this.movW, top.x + top.w);
    const overlap  = overlapR - overlapL;

    if (overlap <= 0) {
      // chybił!
      this._banner = { text: '❌ CHYBIŁ!', t: 1200, color: '#ef4444' };
      this._endGame();
      return;
    }

    // sprawdź PERFECT (prawie idealnie)
    const perfect = Math.abs(overlap - top.w) < PERFECT_TOL && Math.abs(this.movW - top.w) < PERFECT_TOL;

    // nadmiar odpadający
    const debrisY = this._floorScreenY(this.floors.length);

    // lewy nadmiar
    if (overlapL > this.movX) {
      const dw = overlapL - this.movX;
      this._debris.push({
        x: this.movX, y: debrisY, w: dw,
        vy: 0.05, t: 900,
        color: floorColor(this.score),
      });
    }
    // prawy nadmiar
    if (overlapR < this.movX + this.movW) {
      const dw = (this.movX + this.movW) - overlapR;
      this._debris.push({
        x: overlapR, y: debrisY, w: dw,
        vy: 0.05, t: 900,
        color: floorColor(this.score),
      });
    }

    // nowe piętro
    const newFloor = { x: overlapL, w: overlap };
    this.floors.push(newFloor);
    this.score++;

    // za wąskie = game over
    if (overlap < this.W * MIN_W_FRAC) {
      this._banner = { text: '💥 ZA WĄSKO!', t: 1200, color: '#f97316' };
      this._endGame();
      return;
    }

    // scroll: gdy wieża urośnie powyżej środka ekranu
    const topFloorY = this._floorScreenY(this.floors.length - 1);
    const targetY   = this.H * 0.45;
    if (topFloorY < targetY) {
      this.scrollOff += targetY - topFloorY;
    }

    // następny blok = szerokość nowego piętra
    this.movW   = overlap;
    // startuje od krawędzi (losowa strona)
    this.movDir = Math.random() < 0.5 ? 1 : -1;
    this.movX   = this.movDir === 1 ? 0 : this.W - this.movW;

    // prędkość
    this.movSpd = this._currentSpd();

    if (perfect) {
      this._banner = { text: '✨ PERFECT!', t: 1100, color: '#fde047' };
    }

    this._emitStats();
  }

  _endGame() {
    this._gameOver = true;
    // krótkie opóźnienie żeby banner był widoczny
    setTimeout(() => {
      this.running = false;
      this.emit('end', { score: this.score });
    }, 1300);
  }

  draw() {
    const { ctx, W, H } = this;

    // tło — ciemny gradient nocnego miasta
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#0a0e1a');
    bgGrad.addColorStop(0.6, '#0f172a');
    bgGrad.addColorStop(1, '#1e1b4b');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // subtelne okna w tle
    this._drawCityBg();

    const bh = this._blockH();

    // piętra wieży
    for (let i = 0; i < this.floors.length; i++) {
      const f  = this.floors[i];
      const fy = this._floorScreenY(i);

      // nie rysuj jeśli poza ekranem
      if (fy > H + bh || fy + bh < 0) continue;

      const color = i === 0 ? '#374151' : floorColor(i - 1);
      ctx.save();
      ctx.fillStyle   = color;
      ctx.shadowColor = color;
      ctx.shadowBlur  = 10;
      ctx.beginPath();
      ctx.roundRect(f.x, fy, f.w, bh, 4);
      ctx.fill();

      // połysk
      ctx.globalAlpha = 0.2;
      ctx.fillStyle   = '#fff';
      ctx.shadowBlur  = 0;
      ctx.beginPath();
      ctx.roundRect(f.x + 3, fy + 2, f.w - 6, bh * 0.35, 3);
      ctx.fill();
      ctx.restore();
    }

    // odpadające fragmenty
    for (const d of this._debris) {
      ctx.save();
      ctx.globalAlpha = clamp(d.t / 500, 0, 0.85);
      ctx.fillStyle   = d.color;
      ctx.shadowColor = d.color;
      ctx.shadowBlur  = 6;
      ctx.beginPath();
      ctx.roundRect(d.x, d.y, d.w, bh, 3);
      ctx.fill();
      ctx.restore();
    }

    // poruszający się blok (glow efekt)
    if (!this._gameOver) {
      const my = this._movScreenY();
      const topFloor = this.floors[this.floors.length - 1];

      // glow
      radialGlow(ctx, this.movX + this.movW / 2, my + bh / 2, this.movW * 0.7, '#60a5fa', 0.25);

      ctx.save();
      ctx.fillStyle   = '#3b82f6';
      ctx.shadowColor = '#93c5fd';
      ctx.shadowBlur  = 18;
      ctx.beginPath();
      ctx.roundRect(this.movX, my, this.movW, bh, 4);
      ctx.fill();

      // połysk
      ctx.globalAlpha = 0.3;
      ctx.fillStyle   = '#fff';
      ctx.shadowBlur  = 0;
      ctx.beginPath();
      ctx.roundRect(this.movX + 3, my + 2, this.movW - 6, bh * 0.35, 3);
      ctx.fill();
      ctx.restore();

      // linia pomocnicza — zaznaczenie overlap z aktualnym szczytem
      const overlapL = Math.max(this.movX, topFloor.x);
      const overlapR = Math.min(this.movX + this.movW, topFloor.x + topFloor.w);
      if (overlapR > overlapL) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth   = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(overlapL, my);
        ctx.lineTo(overlapL, my + bh);
        ctx.moveTo(overlapR, my);
        ctx.lineTo(overlapR, my + bh);
        ctx.stroke();
        ctx.restore();
      }
    }

    // banner
    if (this._banner) {
      ctx.save();
      const alpha = Math.min(1, this._banner.t / 400);
      ctx.globalAlpha = alpha;
      ctx.fillStyle   = this._banner.color;
      ctx.shadowColor = this._banner.color; ctx.shadowBlur = 28;
      ctx.font = `800 ${Math.round(W / 8)}px Outfit,sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this._banner.text, W / 2, H / 3);
      ctx.restore();
    }

    // HUD — wynik
    ctx.save();
    ctx.fillStyle    = 'rgba(255,255,255,0.85)';
    ctx.font         = `bold ${Math.round(W / 14)}px Outfit,sans-serif`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.shadowColor  = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 6;
    ctx.fillText(`${this.score} pięter`, 12, 12);
    ctx.restore();

    // prędkość bloku (wskaźnik)
    const spdFrac = (this.movSpd - BASE_SPD) / (MAX_SPD - BASE_SPD);
    if (spdFrac > 0.01) {
      ctx.save();
      ctx.fillStyle = `hsl(${Math.round(120 - spdFrac * 120)},80%,55%)`;
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 5;
      ctx.fillRect(0, H - 4, W * clamp(spdFrac, 0, 1), 4);
      ctx.restore();
    }
  }

  _drawCityBg() {
    const { ctx, W, H } = this;
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.fillStyle   = '#60a5fa';
    // kilka prostokątów udających budynki w tle
    const buildings = [
      { x: 0.05, w: 0.08, h: 0.35 },
      { x: 0.15, w: 0.06, h: 0.50 },
      { x: 0.22, w: 0.10, h: 0.30 },
      { x: 0.72, w: 0.08, h: 0.42 },
      { x: 0.82, w: 0.06, h: 0.55 },
      { x: 0.90, w: 0.09, h: 0.38 },
    ];
    for (const b of buildings) {
      ctx.fillRect(b.x * W, H * (1 - b.h), b.w * W, b.h * H);
    }
    ctx.restore();
  }

  drawIdle() { this.draw(); }
  destroy()  { this.running = false; }

  _emitStats() {
    const lvl = 1 + Math.floor(this.score / SPD_LEVELS);
    this.emit('stats', `🏗️ <b>${this.score}</b> pięter &nbsp;·&nbsp; ⚡ Poz. <b>${lvl}</b>`);
  }
}
