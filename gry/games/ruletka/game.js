// gz °/s → rad/ms, wzmocnione ×2 dla lepszego feel
const GZ_TO_VEL = Math.PI / 180 / 1000 * 2;
const SPIN_DEC  = 0.00008;  // hamowanie (rad/ms²) — powolne, żeby bylo widowiskowe
const STOP_GZ   = 4;        // °/s — poniżej = "kapsel się zatrzymał"
const STOP_TIME = 500;      // ms ciszy gz zanim wheel idzie w tryb settle
const MIN_VEL   = 0.004;    // minimalna prędkość po puszczeniu (zawsze coś się kręci)

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

// stany: idle → ready → active → settling → done → idle
export default class RuletkaGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas;
    this.ctx    = ctx;
    this.triki  = triki;
    this.emit   = emit;

    this._setIdx   = 0;
    this._angle    = 0;
    this._vel      = 0;
    this._state    = 'idle';   // idle|ready|active|settling|done
    this._result   = null;
    this._stopLow  = 0;        // ile ms gz jest poniżej STOP_GZ
    this._t        = 0;
    this._running  = false;
    this._resultAlpha = 0;
    this._flashAlpha  = 0;
    this._maxVel      = 0;     // maks prędkość podczas kręcenia
  }

  start()  { this._running = true; this._result = null; this._state = 'idle'; this._resultAlpha = 0; }
  stop()   { this._running = false; }
  resize() {}

  _settle() {
    // oblicz wynik na podstawie aktualnego kąta
    const segs = SETS[this._setIdx].segments;
    const n    = segs.length;
    const norm = ((this._angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const idx  = Math.floor(((Math.PI * 2 - norm) / (Math.PI * 2)) * n + 0.5) % n;
    this._result = segs[idx];
    this._state  = 'done';
    this._resultAlpha = 0;
    this._flashAlpha  = 1;
  }

  _reset() {
    this._state  = 'idle';
    this._result = null;
    this._resultAlpha = 0;
    this._vel    = 0;
    this._maxVel = 0;
  }

  update(dt) {
    this._t += dt;
    if (!this._running) return;

    const gz  = this.triki.gz;   // °/s, −CW +CCW
    const btn = this.triki.consumeClick?.();

    if (this._state === 'idle') {
      if (btn) {
        this._state   = 'ready';
        this._stopLow = 0;
        this._maxVel  = 0;
      }

    } else if (this._state === 'ready') {
      // czekamy aż user zacznie kręcić
      const absGz = Math.abs(gz);
      if (absGz > STOP_GZ) {
        this._state = 'active';
      }
      // anuluj jeśli przycisk ponownie
      if (btn) { this._reset(); return; }

    } else if (this._state === 'active') {
      // koło kręci się proporcjonalnie do gz kapsla
      const absGz = Math.abs(gz);
      this._vel = Math.abs(gz) * GZ_TO_VEL;  // zawsze dodatnia (kręć w jedną stronę)
      if (this._vel > this._maxVel) this._maxVel = this._vel;
      this._angle += this._vel * dt;

      // detekcja zatrzymania kapsla
      if (absGz < STOP_GZ) {
        this._stopLow += dt;
        if (this._stopLow >= STOP_TIME) {
          // kapsel zatrzymany — przejdź do settle z ostatnią prędkością
          this._vel = Math.max(MIN_VEL, this._maxVel * 0.3);
          this._state = 'settling';
          this._stopLow = 0;
        }
      } else {
        this._stopLow = 0;
      }

    } else if (this._state === 'settling') {
      // koło wyhamowuje samodzielnie
      this._vel -= SPIN_DEC * dt;
      if (this._vel <= 0) {
        this._vel = 0;
        this._settle();
      } else {
        this._angle += this._vel * dt;
      }

    } else if (this._state === 'done') {
      this._resultAlpha = Math.min(1, this._resultAlpha + dt * 0.003);
      this._flashAlpha  = Math.max(0, this._flashAlpha - dt * 0.002);
      // przycisk → reset
      if (btn) this._reset();
    }
  }

  draw() {
    const { width: W, height: H } = this.canvas;
    const ctx = this.ctx;
    const CX = W / 2, CY = H * 0.46;
    const R  = Math.min(W, H) * 0.32;

    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, W, H);

    // Flash na wynik
    if (this._flashAlpha > 0 && this._result) {
      ctx.fillStyle = this._result.color + Math.round(this._flashAlpha * 0x33).toString(16).padStart(2,'0');
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

      // Etykieta
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

    // Obwódka koła — podświetl gdy active
    const borderCol = this._state === 'active' ? '#f59e0b'
                    : this._state === 'ready'  ? '#6366f1'
                    : 'rgba(255,255,255,0.2)';
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, Math.PI * 2);
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = this._state === 'active' ? 4 : 3;
    ctx.shadowBlur = this._state === 'active' ? 12 : 0;
    ctx.shadowColor = borderCol;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Środek
    ctx.beginPath();
    ctx.arc(CX, CY, 14, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.shadowBlur = 12;
    ctx.shadowColor = '#fff';
    ctx.fill();
    ctx.shadowBlur = 0;

    // Wskaźnik (strzałka u góry)
    const pY = CY - R - 4;
    ctx.beginPath();
    ctx.moveTo(CX, pY + 22);
    ctx.lineTo(CX - 12, pY + 40);
    ctx.lineTo(CX + 12, pY + 40);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.shadowBlur = 8; ctx.shadowColor = '#fff';
    ctx.fill();
    ctx.shadowBlur = 0;

    // Pasek prędkości (gdy kręci)
    if (this._state === 'active' || this._state === 'settling') {
      const maxVelRef = 0.02;
      const pct = Math.min(1, this._vel / maxVelRef);
      const barW = W * 0.55, barH = 6;
      const barX = CX - barW / 2, barY = CY + R + 20;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath(); ctx.roundRect(barX, barY, barW, barH, 3); ctx.fill();
      ctx.fillStyle = pct > 0.6 ? '#22c55e' : pct > 0.3 ? '#f59e0b' : '#3b82f6';
      ctx.beginPath(); ctx.roundRect(barX, barY, barW * pct, barH, 3); ctx.fill();
    }

    // Wynik
    if (this._result && this._resultAlpha > 0) {
      ctx.globalAlpha = this._resultAlpha;
      const resY = CY + R + 42;
      ctx.fillStyle = this._result.color;
      ctx.font = `900 ${Math.round(W * 0.09)}px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.shadowBlur = 20; ctx.shadowColor = this._result.color;
      ctx.fillText(this._result.label, CX, resY);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;

      // podpowiedź "naciśnij ponownie"
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = `${Math.round(W * 0.032)}px Outfit, sans-serif`;
      ctx.fillText('naciśnij żeby kręcić ponownie', CX, resY + 28);
    }

    // Status / instrukcja
    const statusY = H - 52;
    ctx.textAlign = 'center';
    if (this._state === 'idle') {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = `bold ${Math.round(W * 0.042)}px Outfit, sans-serif`;
      ctx.fillText('Naciśnij przycisk kapsla', CX, statusY);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.font = `${Math.round(W * 0.032)}px Outfit, sans-serif`;
      ctx.fillText('a potem zakręć kapsel', CX, statusY + 22);
    } else if (this._state === 'ready') {
      const pulse = 0.7 + 0.3 * Math.sin(this._t * 0.006);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#6366f1';
      ctx.font = `bold ${Math.round(W * 0.052)}px Outfit, sans-serif`;
      ctx.fillText('Zakręć kapsel!', CX, statusY);
      ctx.globalAlpha = 1;
    } else if (this._state === 'active') {
      ctx.fillStyle = '#f59e0b';
      ctx.font = `bold ${Math.round(W * 0.042)}px Outfit, sans-serif`;
      ctx.fillText('Kręcę…', CX, statusY);
    } else if (this._state === 'settling') {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = `${Math.round(W * 0.038)}px Outfit, sans-serif`;
      ctx.fillText('Wyhamuję…', CX, statusY);
    }

    // Zakładki zestawów — na dole
    const tabH = 34;
    const tabY = H - tabH - 4;
    const tabW = W / SETS.length;
    if (this._state === 'idle' || this._state === 'done') {
      SETS.forEach((s, i) => {
        const active = i === this._setIdx;
        ctx.fillStyle = active ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)';
        ctx.beginPath();
        ctx.roundRect(i * tabW + 4, tabY, tabW - 8, tabH, 8);
        ctx.fill();
        ctx.fillStyle = active ? '#fff' : 'rgba(255,255,255,0.3)';
        ctx.font = `${active ? 'bold ' : ''}${Math.round(W * 0.033)}px Outfit, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(s.name, i * tabW + tabW / 2, tabY + tabH / 2);
      });
      ctx.textBaseline = 'alphabetic';
    }
  }

  onClick(nx, ny) {
    if (!this._running) return;
    // Bez BLE: kliknij żeby wejść w stan ready, koło dostaje losową prędkość
    if (!this.triki.connected) {
      if (this._state === 'idle' || this._state === 'done') {
        this._state   = 'settling';
        this._vel     = 0.006 + Math.random() * 0.012;
        this._result  = null;
        this._resultAlpha = 0;
        this._maxVel  = this._vel;
        return;
      }
    }
    // Zakładki
    const { width: W, height: H } = this.canvas;
    const tabH = 34, tabY = H - tabH - 4, tabW = W / SETS.length;
    const py = ny * H;
    if ((this._state === 'idle' || this._state === 'done') && py >= tabY) {
      const i = Math.floor((nx * W) / tabW);
      if (i >= 0 && i < SETS.length) {
        this._setIdx = i;
        this._reset();
        return;
      }
    }
  }

  onKeyDown(code) {
    if (code === 'Space') {
      if (this._state === 'idle' || this._state === 'done') {
        this._state   = 'settling';
        this._vel     = 0.006 + Math.random() * 0.012;
        this._result  = null;
        this._resultAlpha = 0;
        this._maxVel  = this._vel;
      } else if (this._state === 'ready' || this._state === 'active') {
        this._reset();
      }
    }
    if (code === 'ArrowRight') {
      this._setIdx = (this._setIdx + 1) % SETS.length; this._reset();
    }
    if (code === 'ArrowLeft')  {
      this._setIdx = (this._setIdx + SETS.length - 1) % SETS.length; this._reset();
    }
  }

  onMouseMove() {}
  onKeyUp() {}
}
