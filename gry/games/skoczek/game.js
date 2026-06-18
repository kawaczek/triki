// games/skoczek/game.js — Skoczek (Doodle Jump)
// Sterowanie: przechył L/R kapslem, mysz, strzałki.
// Platformy: normalna (zielona), krucha (brązowa, znika po skoku), sprężynowa (żółta, x2 odbój).

import { clamp, rand, radialGlow } from '../../static/gameutils.js';

const GRAVITY       = 0.0025;   // px/ms²
const JUMP_VY       = -0.9;     // px/ms — normalny odbój
const SPRING_VY     = -1.7;     // px/ms — sprężynowy odbój
const DAMP_X        = 0.85;     // tłumienie boczne / klatkę
const SENS_BLE      = 0.0055;   // czułość przechyłu BLE
const SENS_KEYS     = 0.0018;   // px/ms na klawisz
const SCROLL_THRESH = 0.33;     // górna 1/3 ekranu = przewijanie
const PLAT_COUNT    = 6;        // docelowa liczba platform na ekranie
const PLAT_W_MIN    = 0.18;     // min szerokość (fraction W)
const PLAT_W_MAX    = 0.28;
const PLAT_H        = 12;
const FROG_R        = 20;
const METERS_PER_PX = 0.05 / 50; // 0.05m na 50px scrollu

export default class SkoczekGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas  = canvas;
    this.ctx     = ctx;
    this.triki   = triki;
    this.emit    = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;
    this._mx = 0.5;
    this._initState();
  }

  _initState() {
    // skoczek
    this.x  = this.W / 2;
    this.y  = this.H * 0.7;
    this.vx = 0;
    this.vy = 0;
    // scroll
    this.scrollY   = 0;  // łączny scroll w pikselach
    this.score     = 0;  // metry
    this.platforms = [];
    this._deadParts = []; // odpadające animacje (sprężyna, skruszone platformy)
    this._banner   = null;
    this._genInitialPlatforms();
  }

  _genInitialPlatforms() {
    this.platforms = [];
    // podłoga startowa — szeroka platforma pod skoczkiem
    this.platforms.push({
      x: this.W / 2 - this.W * 0.25,
      y: this.y + FROG_R + 2,
      w: this.W * 0.5,
      type: 'normal',
      alive: true,
    });
    // wypełnij resztę ekranu
    for (let i = 1; i < PLAT_COUNT + 2; i++) {
      this._spawnPlatformAt(this.H * (1 - i / (PLAT_COUNT + 2)));
    }
  }

  _spawnPlatformAt(y) {
    const W = this.W;
    const w = rand(W * PLAT_W_MIN, W * PLAT_W_MAX);
    const x = rand(0, W - w);
    const r = Math.random();
    const type = r < 0.70 ? 'normal' : r < 0.88 ? 'spring' : 'fragile';
    this.platforms.push({ x, y, w, type, alive: true });
  }

  start(player) {
    this.player  = player;
    this._mx     = 0.5;
    this._initState();
    // skoczek startuje z wyskoku z podłogi
    this.vy = JUMP_VY;
    this.running = true;
    this._emitStats();
  }

  resize(W, H) { this.W = W; this.H = H; }

  onMouseMove(nx, ny) { this._mx = nx; }
  onClick()    {}
  onKeyDown(code) {
    // onKeyUp nie jest w kontrakcie — stosujemy impuls vx na każde naciśnięcie
    const kick = this.W * 0.0012;
    if (code === 'ArrowLeft'  || code === 'KeyA') this.vx -= kick;
    if (code === 'ArrowRight' || code === 'KeyD') this.vx += kick;
  }

  update(dt) {
    if (!this.running) return;

    // --- INPUT ---
    if (this.triki.connected) {
      // BLE: -GZ() = poziom L/R (+prawo, -lewo)
      const gz = -this.triki.GZ();
      this.vx += gz * SENS_BLE * dt;
    } else {
      // mysz — płynna interpolacja w kierunku kursora
      const targetX = this._mx * this.W;
      const diff = targetX - this.x;
      this.vx += diff * 0.00008 * dt;
    }

    // tłumienie
    this.vx *= Math.pow(DAMP_X, dt / 16.67);

    // grawitacja
    this.vy += GRAVITY * dt;

    // ruch
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // wrap-around
    if (this.x < -FROG_R)     this.x = this.W + FROG_R;
    if (this.x > this.W + FROG_R) this.x = -FROG_R;

    // --- KOLIZJE Z PLATFORMAMI (tylko przy opadaniu) ---
    if (this.vy > 0) {
      for (const p of this.platforms) {
        if (!p.alive) continue;
        const feet = this.y + FROG_R;
        const prevFeet = feet - this.vy * dt;
        if (
          prevFeet <= p.y + PLAT_H / 2 &&
          feet >= p.y - PLAT_H / 2 &&
          this.x + FROG_R * 0.6 >= p.x &&
          this.x - FROG_R * 0.6 <= p.x + p.w
        ) {
          if (p.type === 'spring') {
            this.vy = SPRING_VY;
            this._banner = { text: '🌀 BOING!', t: 800, color: '#eab308' };
          } else {
            this.vy = JUMP_VY;
          }
          if (p.type === 'fragile') {
            p.alive = false;
            // animacja opadania
            this._deadParts.push({ x: p.x, y: p.y, w: p.w, vy: 0.12, t: 600 });
          }
          break;
        }
      }
    }

    // --- SCROLL ---
    const scrollTrigger = this.H * SCROLL_THRESH;
    if (this.y < scrollTrigger) {
      const shift = scrollTrigger - this.y;
      this.y = scrollTrigger;
      // przesuń platformy w dół
      for (const p of this.platforms) p.y += shift;
      // przesuń animacje
      for (const dp of this._deadParts) dp.y += shift;
      this.scrollY += shift;
      this.score = this.scrollY * METERS_PER_PX;
      this._emitStats();
    }

    // --- NOWE PLATFORMY ---
    // usuń te, które wyszły za dół + martwe
    this.platforms = this.platforms.filter(p => p.y < this.H + 40 && p.alive);
    // dodaj nowe na górze, jeśli za mało
    while (this.platforms.length < PLAT_COUNT) {
      const topmost = this.platforms.reduce((m, p) => Math.min(m, p.y), this.H);
      this._spawnPlatformAt(topmost - rand(70, 130));
    }

    // animacje odpadających platform
    this._deadParts = this._deadParts.filter(dp => dp.t > 0);
    for (const dp of this._deadParts) {
      dp.vy += GRAVITY * dt * 0.5;
      dp.y  += dp.vy * dt;
      dp.t  -= dt;
    }

    // baner
    if (this._banner) { this._banner.t -= dt; if (this._banner.t <= 0) this._banner = null; }

    // --- GAME OVER ---
    if (this.y > this.H + FROG_R * 2) {
      this.running = false;
      this.emit('end', { score: Math.round(this.score * 10) / 10 });
    }
  }

  draw() {
    const { ctx, W, H } = this;

    // tło — gradient niebo
    const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
    skyGrad.addColorStop(0, '#0f172a');
    skyGrad.addColorStop(0.5, '#1e3a5f');
    skyGrad.addColorStop(1, '#164e63');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H);

    // gwiazdy (losowe ale stałe — seed z scrollY)
    this._drawStars();

    // platformy
    for (const p of this.platforms) {
      if (!p.alive) continue;
      this._drawPlatform(p);
    }

    // odpadające fragmenty platform (kruche)
    for (const dp of this._deadParts) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, dp.t / 600) * 0.7;
      ctx.fillStyle   = '#92400e';
      ctx.shadowColor = '#b45309';
      ctx.shadowBlur  = 6;
      ctx.beginPath();
      ctx.roundRect(dp.x, dp.y, dp.w, PLAT_H, 4);
      ctx.fill();
      ctx.restore();
    }

    // skoczek (żabka)
    this._drawFrog(this.x, this.y);

    // baner
    if (this._banner) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this._banner.t / 300);
      ctx.fillStyle   = this._banner.color || '#22c55e';
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 20;
      ctx.font = `800 ${Math.round(W / 9)}px Outfit,sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(this._banner.text, W / 2, H / 3);
      ctx.restore();
    }

    // HUD — wynik
    ctx.save();
    ctx.fillStyle    = 'rgba(255,255,255,0.85)';
    ctx.font         = `bold ${Math.round(W / 14)}px Outfit,sans-serif`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.shadowColor  = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 6;
    ctx.fillText(`${Math.round(this.score * 10) / 10} m`, 12, 12);
    ctx.restore();
  }

  _drawStars() {
    const { ctx, W, H, scrollY } = this;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    // 30 pseudo-losowych gwiazd (deterministyczne)
    for (let i = 0; i < 30; i++) {
      const sx = ((i * 2317 + 1) % 997) / 997 * W;
      const sy = (((i * 1733 + scrollY * 0.15) % H) + H) % H;
      const sr = 0.5 + (i % 3) * 0.5;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawPlatform(p) {
    const { ctx } = this;
    ctx.save();

    const colors = {
      normal:  ['#16a34a', '#15803d'],
      fragile: ['#92400e', '#78350f'],
      spring:  ['#ca8a04', '#a16207'],
    };
    const [fill, shadow] = colors[p.type] || colors.normal;

    // cień
    ctx.shadowColor = shadow;
    ctx.shadowBlur  = 8;
    ctx.fillStyle   = fill;
    ctx.beginPath();
    ctx.roundRect(p.x, p.y - PLAT_H / 2, p.w, PLAT_H, 5);
    ctx.fill();

    // sprężynka — żółty połysk
    if (p.type === 'spring') {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle   = '#fde68a';
      ctx.shadowBlur  = 0;
      ctx.beginPath();
      ctx.roundRect(p.x + p.w * 0.35, p.y - PLAT_H / 2, p.w * 0.3, PLAT_H * 0.4, 3);
      ctx.fill();
    }

    // krucha — pęknięcia
    if (p.type === 'fragile') {
      ctx.strokeStyle = 'rgba(255,200,100,0.35)';
      ctx.lineWidth   = 1;
      ctx.globalAlpha = 0.7;
      for (let i = 0; i < 3; i++) {
        const cx = p.x + p.w * (0.2 + i * 0.3);
        ctx.beginPath();
        ctx.moveTo(cx, p.y - PLAT_H / 2);
        ctx.lineTo(cx + 4, p.y + PLAT_H / 2);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  _drawFrog(x, y) {
    const { ctx } = this;
    const r = FROG_R;
    ctx.save();

    // glow
    radialGlow(ctx, x, y, r * 2.2, '#22c55e', 0.3);

    // ciało
    ctx.fillStyle   = '#16a34a';
    ctx.shadowColor = '#22c55e';
    ctx.shadowBlur  = 12;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // lśniąca górna część
    ctx.fillStyle = '#4ade80';
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.ellipse(x - r * 0.1, y - r * 0.25, r * 0.55, r * 0.32, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // oczy
    const eyeR = r * 0.22;
    const eyeOX = r * 0.38;
    const eyeOY = -r * 0.28;
    [-1, 1].forEach(sgn => {
      // białko
      ctx.fillStyle = '#fff';
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(x + sgn * eyeOX, y + eyeOY, eyeR, 0, Math.PI * 2);
      ctx.fill();
      // źrenica
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.arc(x + sgn * eyeOX + sgn * eyeR * 0.2, y + eyeOY, eyeR * 0.55, 0, Math.PI * 2);
      ctx.fill();
    });

    // uśmiech
    ctx.strokeStyle = '#14532d';
    ctx.lineWidth   = 1.5;
    ctx.shadowBlur  = 0;
    ctx.beginPath();
    ctx.arc(x, y + r * 0.1, r * 0.35, 0.2, Math.PI - 0.2);
    ctx.stroke();

    ctx.restore();
  }

  drawIdle() { this.draw(); }
  destroy()  { this.running = false; }

  _emitStats() {
    this.emit('stats', `🐸 <b>${Math.round(this.score * 10) / 10}</b> m`);
  }
}
