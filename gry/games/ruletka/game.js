const SHAKE_G   = 1.30;
const SHAKE_DEB = 800;
const SPIN_DEC  = 0.0018;   // hamowanie kątowe (rad/ms²)

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
      { label: 'TY',            color: '#ef4444' },
      { label: 'ON/ONA',        color: '#3b82f6' },
      { label: 'WSZYSCY PO RÓWNO', color: '#22c55e' },
      { label: 'TY',            color: '#ef4444' },
      { label: 'KOLEJNA RUNDA', color: '#f59e0b' },
      { label: 'KAŻDY SAM',     color: '#6366f1' },
    ],
  },
];

export default class RuletkaGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas;
    this.ctx    = ctx;
    this.triki  = triki;
    this.emit   = emit;

    this._setIdx  = 0;
    this._angle   = 0;      // kąt obrotu koła (rad)
    this._vel     = 0;      // prędkość kątowa (rad/ms)
    this._spinning = false;
    this._result   = null;  // wygrany segment
    this._prevG    = 0;
    this._lastSpin = -9999;
    this._t        = 0;
    this._running  = false;
    this._resultAlpha = 0;
  }

  start()  { this._running = true; this._result = null; this._resultAlpha = 0; }
  stop()   { this._running = false; }
  resize() {}

  _spin() {
    if (this._spinning) return;
    this._vel     = 0.012 + Math.random() * 0.016;  // losowa prędkość
    this._spinning = true;
    this._result   = null;
    this._resultAlpha = 0;
    this._lastSpin = this._t;
  }

  _settle() {
    this._spinning = false;
    const segs = SETS[this._setIdx].segments;
    const n    = segs.length;
    const norm = ((this._angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    // wskaźnik na górze (angle=0 to 12h), koło obraca się CW
    const idx  = Math.floor(((Math.PI * 2 - norm) / (Math.PI * 2)) * n + 0.5) % n;
    this._result = segs[idx];
  }

  update(dt) {
    this._t += dt;
    if (!this._running) return;

    if (this._spinning) {
      this._vel  -= SPIN_DEC * dt;
      if (this._vel <= 0) { this._vel = 0; this._settle(); }
      else this._angle += this._vel * dt;
    }

    if (this._result) {
      this._resultAlpha = Math.min(1, this._resultAlpha + dt * 0.003);
    }

    // BLE shake
    const g = Math.hypot(this.triki.ax, this.triki.ay, this.triki.az);
    if (g >= SHAKE_G && this._prevG < SHAKE_G && this._t - this._lastSpin > SHAKE_DEB) {
      this._spin();
    }
    this._prevG = g;

    // BLE button
    if (this.triki.consumeClick?.() && this._t - this._lastSpin > SHAKE_DEB) {
      this._spin();
    }
  }

  draw() {
    const { width: W, height: H } = this.canvas;
    const ctx = this.ctx;
    const CX = W / 2, CY = H * 0.48;
    const R  = Math.min(W, H) * 0.32;

    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, W, H);

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
      // Wielolinijkowy tekst przy długich etykietach
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
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Środek
    ctx.beginPath();
    ctx.arc(CX, CY, 14, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.shadowBlur = 12;
    ctx.shadowColor = '#fff';
    ctx.fill();
    ctx.shadowBlur = 0;

    // Wskaźnik (strzałka u góry)
    const pX = CX, pY = CY - R - 4;
    ctx.beginPath();
    ctx.moveTo(pX, pY + 22);
    ctx.lineTo(pX - 12, pY + 40);
    ctx.lineTo(pX + 12, pY + 40);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.shadowBlur = 8; ctx.shadowColor = '#fff';
    ctx.fill();
    ctx.shadowBlur = 0;

    // Wynik
    if (this._result && this._resultAlpha > 0) {
      ctx.globalAlpha = this._resultAlpha;
      const resY = CY + R + 38;
      ctx.fillStyle = this._result.color;
      ctx.font = `900 ${Math.round(W * 0.09)}px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.shadowBlur = 20; ctx.shadowColor = this._result.color;
      ctx.fillText(this._result.label, CX, resY);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    // Zakładki zestawów
    const tabH = 34;
    const tabY = H - tabH - 6;
    const tabW = W / SETS.length;
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

    // Spinning hint
    if (!this._spinning && !this._result) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = `${Math.round(W * 0.038)}px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('potrząśnij lub kliknij', CX, tabY - 14);
    }
  }

  onClick(nx, ny) {
    if (!this._running) return;
    const { width: W, height: H } = this.canvas;
    // Zakładki
    const tabH = 34;
    const tabY = H - tabH - 6;
    const tabW = W / SETS.length;
    const py = ny * H;
    if (py >= tabY) {
      const i = Math.floor((nx * W) / tabW);
      if (i >= 0 && i < SETS.length) {
        this._setIdx = i;
        this._result = null;
        this._resultAlpha = 0;
        return;
      }
    }
    this._spin();
  }

  onKeyDown(code) {
    if (code === 'Space')      { this._spin(); return; }
    if (code === 'ArrowRight') {
      this._setIdx = (this._setIdx + 1) % SETS.length;
      this._result = null; this._resultAlpha = 0;
    }
    if (code === 'ArrowLeft')  {
      this._setIdx = (this._setIdx + SETS.length - 1) % SETS.length;
      this._result = null; this._resultAlpha = 0;
    }
  }

  onMouseMove() {}
  onKeyUp() {}
}
