// gz °/s → wheel rad/ms (wzmocnienie ×2)
const GZ_TO_VEL  = Math.PI / 180 / 1000 * 2;
const SPIN_DEC   = 0.000003;  // POWOLNE hamowanie — 0.01 rad/ms zatrzymuje się w ~3s
const STOP_GZ    = 5;         // °/s — poniżej = kapsel nieruchomy
const STOP_TIME  = 400;       // ms bez ruchu zanim wheel wychodzi z follow-mode
const MIN_SETTLE = 0.006;     // minimalna prędkość na start settligu (zawsze >1s obrotu)

const SETS = [
  {
    name: 'TAK / NIE',
    segments: [
      { label: 'TAK',            color: '#22c55e' },
      { label: 'NIE',            color: '#ef4444' },
      { label: 'MOŻE',           color: '#f59e0b' },
      { label: 'TAK',            color: '#22c55e' },
      { label: 'NIE',            color: '#ef4444' },
      { label: 'ZAPYTAJ JUTRO',  color: '#6366f1' },
    ],
  },
  {
    name: 'Forfeit',
    segments: [
      { label: '10 POMPEK',     color: '#ef4444' },
      { label: 'ŚPIEWAJ',       color: '#a855f7' },
      { label: 'TANIEC',        color: '#ec4899' },
      { label: 'PRAWDA',        color: '#3b82f6' },
      { label: 'ODWAGA',        color: '#f59e0b' },
      { label: 'WOLNE',         color: '#22c55e' },
    ],
  },
  {
    name: 'Kto płaci?',
    segments: [
      { label: 'TY',               color: '#ef4444' },
      { label: 'ON/ONA',           color: '#3b82f6' },
      { label: 'WSZYSCY PO RÓWNO', color: '#22c55e' },
      { label: 'TY',               color: '#ef4444' },
      { label: 'KOLEJNA RUNDA',    color: '#f59e0b' },
      { label: 'KAŻDY SAM',        color: '#6366f1' },
    ],
  },
];

export default class RuletkaGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas;
    this.ctx    = ctx;
    this.triki  = triki;
    this.emit   = emit;

    this._setIdx      = 0;
    this._angle       = 0;
    this._vel         = 0;
    this._state       = 'idle';  // idle|ready|active|settling|done
    this._result      = null;
    this._stopLow     = 0;
    this._t           = 0;
    this._running     = false;
    this._resultAlpha = 0;
    this._flashAlpha  = 0;
    this._maxVel      = 0;
  }

  start()  {
    this._running = true;
    this._result  = null;
    this._state   = 'idle';
    this._resultAlpha = 0;
    this._vel     = 0;
  }
  stop()   { this._running = false; }
  resize() {}

  _startSettle(baseVel) {
    // dodaj losowy szum żeby wynik nie był deterministyczny
    this._vel  = Math.max(MIN_SETTLE, baseVel) + Math.random() * 0.004;
    this._state = 'settling';
    this._result = null;
    this._resultAlpha = 0;
  }

  _computeResult() {
    const segs = SETS[this._setIdx].segments;
    const n    = segs.length;
    const norm = ((this._angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const idx  = Math.floor(((Math.PI * 2 - norm) / (Math.PI * 2)) * n + 0.5) % n;
    this._result      = segs[idx];
    this._state       = 'done';
    this._resultAlpha = 0;
    this._flashAlpha  = 1;
  }

  _reset() {
    this._state       = 'idle';
    this._result      = null;
    this._resultAlpha = 0;
    this._vel         = 0;
    this._maxVel      = 0;
    this._stopLow     = 0;
  }

  update(dt) {
    this._t += dt;
    if (!this._running) return;

    const btn = this.triki.connected && this.triki.consumeClick?.();
    const rotVal = this.triki.connected ? (this.triki.ROT?.() ?? 0) : 0;

    // Wykrywanie potrząsania
    const g = Math.hypot(this.triki.ax, this.triki.ay, this.triki.az);
    const isShaking = this.triki.connected && (Math.abs(g - 1.0) > 0.22);

    if (this._state === 'idle' || this._state === 'done') {
      // 1. Zmiana zestawu opcji przyciskiem kapsla
      if (btn) {
        this._setIdx = (this._setIdx + 1) % SETS.length;
        this._reset();
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(40);
        return;
      }

      // 2. Kręcenie kołem przez potrząśnięcie lub szybki obrót kapsla
      if (isShaking) {
        this._startSettle(0.014 + Math.random() * 0.008);
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(60);
      } else if (Math.abs(rotVal) > 22) {
        // Oblicz prędkość początkową na podstawie szybkości obrotu kapsla
        const initialVel = Math.min(0.025, Math.max(0.008, Math.abs(rotVal) * 0.0003));
        this._startSettle(initialVel);
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(60);
      }
    } else if (this._state === 'settling') {
      // Wyhamowywanie koła
      this._vel = Math.max(0, this._vel - SPIN_DEC * dt);
      this._angle += this._vel * dt;
      if (this._vel === 0) {
        this._computeResult();
      }
    } else if (this._state === 'done') {
      this._resultAlpha = Math.min(1, this._resultAlpha + dt * 0.003);
      this._flashAlpha  = Math.max(0, this._flashAlpha  - dt * 0.002);
    }
  }

  draw() {
    const { width: W, height: H } = this.canvas;
    const ctx = this.ctx;
    const CX  = W / 2, CY = H * 0.46;
    const R   = Math.min(W, H) * 0.32;

    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, W, H);

    // Flash przy wyniku
    if (this._flashAlpha > 0 && this._result) {
      ctx.fillStyle = this._result.color +
        Math.round(this._flashAlpha * 0x30).toString(16).padStart(2, '0');
      ctx.fillRect(0, 0, W, H);
    }

    const segs = SETS[this._setIdx].segments;
    const n    = segs.length;
    const step = (Math.PI * 2) / n;

    // Koło
    for (let i = 0; i < n; i++) {
      const a0 = this._angle + i * step - Math.PI / 2;
      const a1 = a0 + step;
      ctx.beginPath();
      ctx.moveTo(CX, CY);
      ctx.arc(CX, CY, R, a0, a1);
      ctx.closePath();
      ctx.fillStyle = segs[i].color;
      ctx.fill();
      ctx.strokeStyle = '#0a0c10';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Etykieta segmentu
      const mid  = a0 + step / 2;
      const tx   = CX + Math.cos(mid) * R * 0.65;
      const ty   = CY + Math.sin(mid) * R * 0.65;
      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(mid + Math.PI / 2);
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(R * 0.175)}px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const words = segs[i].label.split(' ');
      if (words.length === 1 || segs[i].label.length < 8) {
        ctx.fillText(segs[i].label, 0, 0);
      } else {
        const mid1 = Math.ceil(words.length / 2);
        ctx.fillText(words.slice(0, mid1).join(' '), 0, -R * 0.09);
        ctx.fillText(words.slice(mid1).join(' '), 0,  R * 0.09);
      }
      ctx.restore();
    }

    // Obwódka koła
    const borderCol = this._state === 'active'   ? '#f59e0b'
                    : this._state === 'ready'    ? '#6366f1'
                    : this._state === 'settling' ? '#22c55e'
                    : 'rgba(255,255,255,0.2)';
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, Math.PI * 2);
    ctx.strokeStyle = borderCol;
    ctx.lineWidth   = (this._state === 'active' || this._state === 'settling') ? 4 : 3;
    ctx.shadowBlur  = (this._state === 'active' || this._state === 'settling') ? 12 : 0;
    ctx.shadowColor = borderCol;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Środek
    ctx.beginPath();
    ctx.arc(CX, CY, 14, 0, Math.PI * 2);
    ctx.fillStyle  = '#fff';
    ctx.shadowBlur = 10; ctx.shadowColor = '#fff';
    ctx.fill();
    ctx.shadowBlur = 0;

    // Wskaźnik (strzałka na górze)
    const pY = CY - R - 4;
    ctx.beginPath();
    ctx.moveTo(CX, pY + 22);
    ctx.lineTo(CX - 12, pY + 40);
    ctx.lineTo(CX + 12, pY + 40);
    ctx.closePath();
    ctx.fillStyle  = '#fff';
    ctx.shadowBlur = 8; ctx.shadowColor = '#fff';
    ctx.fill();
    ctx.shadowBlur = 0;

    // Pasek prędkości (active + settling)
    if (this._state === 'active' || this._state === 'settling') {
      const ref  = 0.018;
      const pct  = Math.min(1, this._vel / ref);
      const bW   = W * 0.55, bH = 6;
      const bX   = CX - bW / 2, bY = CY + R + 18;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath(); ctx.roundRect(bX, bY, bW, bH, 3); ctx.fill();
      if (pct > 0) {
        ctx.fillStyle = pct > 0.6 ? '#22c55e' : pct > 0.3 ? '#f59e0b' : '#3b82f6';
        ctx.beginPath(); ctx.roundRect(bX, bY, bW * pct, bH, 3); ctx.fill();
      }
    }

    // Wynik
    if (this._result && this._resultAlpha > 0) {
      ctx.globalAlpha = this._resultAlpha;
      const resY = CY + R + 44;
      ctx.fillStyle  = this._result.color;
      ctx.font       = `900 ${Math.round(W * 0.09)}px Outfit, sans-serif`;
      ctx.textAlign  = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.shadowBlur  = 20; ctx.shadowColor = this._result.color;
      ctx.fillText(this._result.label, CX, resY);
      ctx.shadowBlur = 0;
      ctx.fillStyle  = 'rgba(255,255,255,0.3)';
      ctx.font       = `${Math.round(W * 0.032)}px Outfit, sans-serif`;
      ctx.fillText('zakręć 🔄 lub potrząśnij 🫨 by losować ponownie', CX, resY + 28);
      ctx.globalAlpha = 1;
    }

    // Instrukcja / status
    const infoY = H - 64;
    ctx.textAlign = 'center';
    if (this._state === 'idle') {
      ctx.fillStyle = '#fff';
      ctx.font      = `bold ${Math.round(W * 0.042)}px Outfit, sans-serif`;
      ctx.fillText('Zakręć 🔄 lub potrząśnij 🫨 kapsel', CX, infoY);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font      = `${Math.round(W * 0.034)}px Outfit, sans-serif`;
      ctx.fillText('naciśnij przycisk 🔘 aby zmienić zestaw', CX, infoY + 22);
    } else if (this._state === 'settling') {
      ctx.fillStyle = '#f59e0b';
      ctx.font      = `bold ${Math.round(W * 0.046)}px Outfit, sans-serif`;
      ctx.fillText('Koło się kręci… 🎡', CX, infoY + 10);
    } else if (this._state === 'done') {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font      = `${Math.round(W * 0.034)}px Outfit, sans-serif`;
      ctx.fillText('naciśnij przycisk 🔘 aby zmienić zestaw', CX, infoY + 10);
    }

    // Zakładki zestawów
    if (this._state === 'idle' || this._state === 'done') {
      const tabH = 34, tabY = H - tabH - 4, tabW = W / SETS.length;
      SETS.forEach((s, i) => {
        const active = i === this._setIdx;
        ctx.fillStyle = active ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)';
        ctx.beginPath(); ctx.roundRect(i * tabW + 4, tabY, tabW - 8, tabH, 8); ctx.fill();
        ctx.fillStyle    = active ? '#fff' : 'rgba(255,255,255,0.3)';
        ctx.font         = `${active ? 'bold ' : ''}${Math.round(W * 0.033)}px Outfit, sans-serif`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(s.name, i * tabW + tabW / 2, tabY + tabH / 2);
      });
      ctx.textBaseline = 'alphabetic';
    }
  }

  onClick(nx, ny) {
    if (!this._running) return;
    const { width: W, height: H } = this.canvas;

    // Zakładki (tylko gdy idle/done)
    if (this._state === 'idle' || this._state === 'done') {
      const tabH = 34, tabY = H - tabH - 4, tabW = W / SETS.length;
      if (ny * H >= tabY) {
        const i = Math.floor((nx * W) / tabW);
        if (i >= 0 && i < SETS.length) { this._setIdx = i; this._reset(); return; }
      }
    }

    // Bez BLE: kliknięcie = losowy obrót (idle lub done → settling)
    if (!this.triki.connected) {
      if (this._state === 'idle' || this._state === 'done') {
        this._startSettle(0.010 + Math.random() * 0.012);
      }
    }
  }

  onKeyDown(code) {
    if (code === 'Space') {
      if (this._state === 'idle' || this._state === 'done') {
        this._startSettle(0.010 + Math.random() * 0.012);
      } else {
        this._reset();
      }
    }
    if (code === 'ArrowRight') { this._setIdx = (this._setIdx + 1) % SETS.length; this._reset(); }
    if (code === 'ArrowLeft')  { this._setIdx = (this._setIdx + SETS.length - 1) % SETS.length; this._reset(); }
  }

  onMouseMove() {}
  onKeyUp()    {}
}
