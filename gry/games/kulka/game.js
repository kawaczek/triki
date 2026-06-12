// games/kulka/game.js — Kula: labirynt kulkowy sterowany przechyłem kapsla
//
// Fizyka: akcelerometr → siła grawitacji działająca na kulkę (jak fizyczny labirynt).
// Przychylasz kapsel w prawo → kulka toczy się w prawo. Lekki poślizg, odbicie od ścian.
// Przycisk: ⛔ HAMULEC — zeruje prędkość (taktyczny reset)
// Zbierasz gwiazdy → +1 punkt +4 sekundy. Gra trwa 60 sekund.

import { clamp, radialGlow } from '../../static/gameutils.js';

const BALL_R     = 14;
const STAR_R     = 11;
const TIME_START = 60;
const TIME_BONUS = 4;
// Siła grawitacji: GZ(0)/GX(0) ≈ 9 przy 30° przechyle → 720 px/s²
const GRAV       = 80;
// Tłumienie: im wyższe, tym bardziej „lepka" piłka (spokojniejsza gra)
const DAMP_RATE  = 1.6;     // exp(-DAMP_RATE * dt_s) każdą klatkę

export default class KulkaGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas;
    this.ctx    = ctx;
    this.triki  = triki;
    this.emit   = emit;
    this.W = canvas.width;
    this.H = canvas.height;

    this._mx = 0.5; this._my = 0.5;
    this._trail    = [];
    this._brakeMs  = 0;
    this._burst    = [];     // cząsteczki po zebraniu gwiazdy
    this._lastCeil = TIME_START;

    // stan startowy (drawIdle może być wywołane przed start())
    this.ball     = { x: this.W/2, y: this.H/2, vx: 0, vy: 0 };
    this.stars    = [];
    this.score    = 0;
    this.timeLeft = TIME_START;
    this.running  = false;
  }

  // ─── cykl życia ────────────────────────────────────────────
  start(player) {
    this.player   = player;
    this.W = this.canvas.width;
    this.H = this.canvas.height;
    this.ball     = { x: this.W/2, y: this.H/2, vx: 0, vy: 0 };
    this.score    = 0;
    this.timeLeft = TIME_START;
    this._lastCeil = TIME_START;
    this._trail   = [];
    this._brakeMs = 0;
    this._burst   = [];
    this.stars    = [];
    for (let i = 0; i < 3; i++) this._spawnStar();
    this.running  = true;
    this._emitStats();
  }

  resize(W, H) { this.W = W; this.H = H; }
  onMouseMove(nx, ny) { this._mx = nx; this._my = ny; }
  onClick()  {}
  onKeyDown() {}
  destroy()  { this.running = false; }

  // ─── update ────────────────────────────────────────────────
  update(dt) {
    if (!this.running) return;
    const dt_s = dt / 1000;

    // odliczanie
    this.timeLeft = Math.max(0, this.timeLeft - dt_s);
    if (this.timeLeft <= 0) {
      this.running = false;
      this.emit('end', { score: this.score });
      return;
    }

    // flash hamulca
    this._brakeMs = Math.max(0, this._brakeMs - dt);

    // przycisk = hamulec
    if (this.triki.consumeClick()) {
      this.ball.vx = 0;
      this.ball.vy = 0;
      this._brakeMs = 380;
    }

    // ── wejście: przechył kapsla lub kursor ──────────────────
    let ax, ay;
    if (this.triki.connected) {
      // -GZ(0): przechył boczny (lewo/prawo na ekranie)
      // +GX(0): przechył pionowy (góra/dół na ekranie)
      ax = -this.triki.GZ(0);
      ay =  this.triki.GX(0);
    } else {
      // symulacja przechyłu kursorem (środek = neutralny)
      ax = (this._mx - 0.5) * 22;
      ay = (this._my - 0.5) * 22;
    }

    // ── fizyka kulki ─────────────────────────────────────────
    const damp = Math.exp(-DAMP_RATE * dt_s);
    this.ball.vx = this.ball.vx * damp + ax * GRAV * dt_s;
    this.ball.vy = this.ball.vy * damp + ay * GRAV * dt_s;
    this.ball.x += this.ball.vx * dt_s;
    this.ball.y += this.ball.vy * dt_s;

    // ── odbicie od ścian (tłumione) ───────────────────────────
    const R = BALL_R;
    if (this.ball.x < R)        { this.ball.x = R;        this.ball.vx =  Math.abs(this.ball.vx) * 0.42; }
    if (this.ball.x > this.W-R) { this.ball.x = this.W-R; this.ball.vx = -Math.abs(this.ball.vx) * 0.42; }
    if (this.ball.y < R)        { this.ball.y = R;        this.ball.vy =  Math.abs(this.ball.vy) * 0.42; }
    if (this.ball.y > this.H-R) { this.ball.y = this.H-R; this.ball.vy = -Math.abs(this.ball.vy) * 0.42; }

    // ── ślad ─────────────────────────────────────────────────
    this._trail.unshift({ x: this.ball.x, y: this.ball.y, age: 0 });
    if (this._trail.length > 26) this._trail.pop();
    this._trail.forEach(p => p.age += dt);

    // ── zbieranie gwiazd ──────────────────────────────────────
    let collected = false;
    this.stars = this.stars.filter(s => {
      s.phase += dt * 0.0028;
      if (Math.hypot(s.x - this.ball.x, s.y - this.ball.y) < BALL_R + STAR_R) {
        this.score++;
        this.timeLeft = Math.min(TIME_START, this.timeLeft + TIME_BONUS);
        this._spawnBurst(s.x, s.y);
        this._spawnStar();
        collected = true;
        return false;
      }
      return true;
    });
    if (collected) this._emitStats();

    // ── stats co sekundę (timer) ──────────────────────────────
    const ceil = Math.ceil(this.timeLeft);
    if (ceil !== this._lastCeil) { this._lastCeil = ceil; this._emitStats(); }

    // ── cząsteczki burst ─────────────────────────────────────
    this._burst = this._burst
      .map(p => ({ ...p, x: p.x + p.vx*dt_s, y: p.y + p.vy*dt_s, life: p.life - dt }))
      .filter(p => p.life > 0);
  }

  // ─── draw ──────────────────────────────────────────────────
  draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    // tło — delikatna siatka
    ctx.save();
    ctx.strokeStyle = 'rgba(139,92,246,.065)';
    ctx.lineWidth = 1;
    const gs = 38;
    for (let x = 0; x <= W; x += gs) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y = 0; y <= H; y += gs) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
    ctx.restore();

    // burst cząsteczki
    this._burst.forEach(p => {
      const a = (p.life / p.maxLife) * 0.88;
      ctx.save();
      ctx.fillStyle = `rgba(216,180,254,${a})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, 3.5 * (p.life/p.maxLife), 0, Math.PI*2); ctx.fill();
      ctx.restore();
    });

    // gwiazdy
    const now = performance.now() * 0.001;
    this.stars.forEach(s => {
      const pulse = 0.74 + 0.26 * Math.sin(s.phase + now * 2.2);
      const r = STAR_R * pulse;
      radialGlow(ctx, s.x, s.y, r * 3, '#a855f7', 0.48 * pulse);
      ctx.save();
      ctx.fillStyle = `rgba(216,180,254,${0.88 * pulse})`;
      ctx.shadowColor = '#c084fc'; ctx.shadowBlur = 16 * pulse;
      ctx.beginPath();
      this._starPath(ctx, s.x, s.y, r, r * 0.4, 5);
      ctx.fill();
      ctx.restore();
    });

    // ślad
    for (let i = this._trail.length - 1; i >= 0; i--) {
      const p = this._trail[i];
      const frac = 1 - i / this._trail.length;
      const a = frac * frac * 0.42;
      ctx.save();
      ctx.fillStyle = `rgba(139,92,246,${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, BALL_R * frac * 0.6, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }

    // kulka
    const braking = this._brakeMs > 0;
    const col = braking ? '#ef4444' : '#a855f7';
    radialGlow(ctx, this.ball.x, this.ball.y, BALL_R * 2.6, col, braking ? 0.7 : 0.55);
    ctx.save();
    ctx.fillStyle = col;
    ctx.shadowColor = col; ctx.shadowBlur = 22;
    ctx.beginPath(); ctx.arc(this.ball.x, this.ball.y, BALL_R, 0, Math.PI*2); ctx.fill();
    // połysk
    ctx.fillStyle = 'rgba(255,255,255,0.38)';
    ctx.beginPath();
    ctx.arc(this.ball.x - BALL_R*0.3, this.ball.y - BALL_R*0.3, BALL_R*0.36, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    // wektor prędkości
    const spd = Math.hypot(this.ball.vx, this.ball.vy);
    if (spd > 18) {
      const len = clamp(spd * 0.065, 6, 55);
      ctx.save();
      ctx.strokeStyle = 'rgba(168,85,247,0.4)';
      ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(this.ball.x, this.ball.y);
      ctx.lineTo(this.ball.x + (this.ball.vx/spd)*len, this.ball.y + (this.ball.vy/spd)*len);
      ctx.stroke();
      ctx.restore();
    }

    // pasek czasu
    const tf = clamp(this.timeLeft / TIME_START, 0, 1);
    const tc = this.timeLeft < 10 ? '#ef4444' : this.timeLeft < 20 ? '#eab308' : '#a855f7';
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fillRect(0, 0, W, 5);
    ctx.fillStyle = tc; ctx.shadowColor = tc; ctx.shadowBlur = 8;
    ctx.fillRect(0, 0, W * tf, 5);
    ctx.restore();

    // pulsujący licznik gdy <10s
    if (this.timeLeft < 10) {
      ctx.save();
      ctx.fillStyle = '#ef4444';
      ctx.font = `900 ${Math.round(W/6.5)}px Outfit,sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.globalAlpha = 0.62 + 0.38 * Math.abs(Math.sin(performance.now() * 0.007));
      ctx.shadowColor = '#ef4444'; ctx.shadowBlur = 22;
      ctx.fillText(`${Math.ceil(this.timeLeft)}`, W/2, 14);
      ctx.restore();
    }

    // flash hamulca
    if (this._brakeMs > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(239,68,68,${(this._brakeMs/380)*0.15})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // HUD przechyłu (tylko BLE)
    if (this.triki.connected) this._drawTiltHUD();
  }

  // ─── wskaźnik przechyłu (kółko w rogu) ────────────────────
  _drawTiltHUD() {
    const { ctx, W } = this;
    const cx = W - 44, cy = 54, R = 28;

    // normalizacja: GZ(0) ≈ 28 przy mocnym przechyle
    const gx_n = clamp(-this.triki.GZ(0) / 26, -1, 1);
    const gy_n = clamp( this.triki.GX(0) / 26, -1, 1);
    const mag  = Math.hypot(gx_n, gy_n);

    ctx.save();
    ctx.globalAlpha = 0.82;

    // tło kółka
    ctx.fillStyle = 'rgba(6,8,16,0.55)';
    ctx.beginPath(); ctx.arc(cx, cy, R+3, 0, Math.PI*2); ctx.fill();

    // pierścień zewnętrzny
    ctx.strokeStyle = 'rgba(255,255,255,.2)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI*2); ctx.stroke();

    // strefa „mocny przechył"
    ctx.strokeStyle = 'rgba(239,68,68,.22)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI*2); ctx.stroke();

    // strefa neutralna (środkowy okrąg)
    ctx.strokeStyle = 'rgba(255,255,255,.1)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R*0.4, 0, Math.PI*2); ctx.stroke();

    // krzyż
    ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx-R, cy); ctx.lineTo(cx+R, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy-R); ctx.lineTo(cx, cy+R); ctx.stroke();

    // linia od centrum do kropki (pokazuje kierunek)
    const dx = gx_n * R, dy = gy_n * R;
    if (mag > 0.08) {
      ctx.strokeStyle = `rgba(168,85,247,${0.3 + mag*0.3})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx+dx, cy+dy); ctx.stroke();
    }

    // kropka przechyłu
    const dotColor = mag > 0.7 ? '#ef4444' : mag > 0.38 ? '#eab308' : '#a855f7';
    ctx.fillStyle = dotColor; ctx.shadowColor = dotColor; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.arc(cx+dx, cy+dy, 6.5, 0, Math.PI*2); ctx.fill();

    // etykieta
    ctx.globalAlpha = 0.3; ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.font = '8px Outfit,sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('TILT', cx, cy + R + 5);

    ctx.restore();
  }

  // ─── drawIdle (animowany podgląd na hubie) ─────────────────
  drawIdle() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    const t = performance.now() * 0.001;

    // obracające się gwiazdy wokół kulki
    for (let i = 0; i < 3; i++) {
      const a = (i/3)*Math.PI*2 + t * 0.65;
      const sx = W/2 + Math.cos(a)*72, sy = H/2 + Math.sin(a)*72;
      const pulse = 0.8 + 0.2*Math.sin(t*2.1 + i*2.1);
      radialGlow(ctx, sx, sy, 20, '#a855f7', 0.35*pulse);
      ctx.fillStyle = `rgba(216,180,254,${0.75*pulse})`;
      ctx.beginPath(); this._starPath(ctx, sx, sy, STAR_R*pulse, STAR_R*0.4*pulse, 5); ctx.fill();
    }

    // kulka
    radialGlow(ctx, W/2, H/2, BALL_R*2.8, '#a855f7', 0.45);
    ctx.fillStyle = '#a855f7';
    ctx.shadowColor = '#a855f7'; ctx.shadowBlur = 20;
    ctx.beginPath(); ctx.arc(W/2, H/2, BALL_R, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.38)';
    ctx.beginPath();
    ctx.arc(W/2 - BALL_R*0.3, H/2 - BALL_R*0.3, BALL_R*0.36, 0, Math.PI*2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // podpis
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    ctx.font = `500 ${Math.round(W/15)}px Outfit,sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Przechylaj kapslem', W/2, H*0.8);
  }

  // ─── helpers ───────────────────────────────────────────────
  _spawnStar() {
    const m = 48;
    for (let t = 0; t < 80; t++) {
      const x = m + Math.random() * (this.W - 2*m);
      const y = m + Math.random() * (this.H - 2*m);
      if (Math.hypot(x - this.ball.x, y - this.ball.y) < 85) continue;
      if (this.stars.some(s => Math.hypot(s.x-x, s.y-y) < 55)) continue;
      this.stars.push({ x, y, phase: Math.random() * Math.PI * 2 });
      return;
    }
    // fallback
    this.stars.push({ x: m + Math.random()*(this.W-2*m), y: m + Math.random()*(this.H-2*m), phase: 0 });
  }

  _spawnBurst(x, y) {
    for (let i = 0; i < 12; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 65 + Math.random() * 130;
      this._burst.push({ x, y, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed, life: 480, maxLife: 480 });
    }
  }

  _starPath(ctx, cx, cy, outerR, innerR, pts) {
    ctx.beginPath();
    for (let i = 0; i < pts*2; i++) {
      const a = (i * Math.PI / pts) - Math.PI/2;
      const r = (i % 2 === 0) ? outerR : innerR;
      i === 0 ? ctx.moveTo(cx + r*Math.cos(a), cy + r*Math.sin(a))
              : ctx.lineTo(cx + r*Math.cos(a), cy + r*Math.sin(a));
    }
    ctx.closePath();
  }

  _emitStats() {
    const t = Math.ceil(this.timeLeft);
    this.emit('stats', `⭐ <b>${this.score}</b> &nbsp;·&nbsp; ⏱ <b>${t}s</b>`);
  }
}
