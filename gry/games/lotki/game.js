// games/lotki/game.js — Darts: celuj przechyłem, rzuć ruchem kapsla
import { clamp, radialGlow } from '../../static/gameutils.js';

// Standard dartboard sector order clockwise from top
const SECTORS = [20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5];

// Zone radii as fraction of outer double-ring (=1.0)
const RR = {
  bull:   0.040,
  inner:  0.082,
  triIn:  0.358,
  triOut: 0.413,
  dblIn:  0.625,
  dblOut: 1.000,
};

const THROWS  = 5;
const AIM_S   = 14;    // GX/GZ ÷ AIM_S → ±1 at ~14° tilt
const THROW_G = 1.42;  // total g-force threshold for throw detection
const AIM_MIN = 500;   // ms minimum aim time before throw allowed

export default class LotkiGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas  = canvas;
    this.ctx     = ctx;
    this.triki   = triki;
    this.emit    = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;
    this._aimX     = 0;
    this._aimY     = 0;
    this._wobble   = 0.15;
    this._aimBuf   = [];
    this._aimStart = 0;
    this._darts    = [];
    this._throwN   = 0;
    this._total    = 0;
    this._state    = 'idle';  // idle | aiming | result
    this._resultT  = 0;
    this._flash    = null;    // {label, pts, color, t}
    this._mx       = 0.5;
    this._my       = 0.5;
    this._keyAimX  = 0;
    this._keyAimY  = 0;
  }

  start() {
    this._darts    = [];
    this._throwN   = 0;
    this._total    = 0;
    this._aimX     = 0;
    this._aimY     = 0;
    this._wobble   = 0.15;
    this._aimBuf   = [];
    this._aimStart = Date.now();
    this._state    = 'aiming';
    this._flash    = null;
    this._keyAimX  = 0;
    this._keyAimY  = 0;
    this.running   = true;
  }

  resize(W, H) { this.W = W; this.H = H; }

  onMouseMove(nx, ny) {
    this._mx = nx;
    this._my = ny;
  }

  onClick(nx, ny) {
    if (this._state === 'aiming' && Date.now() - this._aimStart >= AIM_MIN) {
      this._doThrow();
    }
  }

  onKeyDown(code) {
    const step = 0.04;
    if (code === 'ArrowLeft')  this._keyAimX -= step;
    if (code === 'ArrowRight') this._keyAimX += step;
    if (code === 'ArrowUp')    this._keyAimY -= step;
    if (code === 'ArrowDown')  this._keyAimY += step;
    this._keyAimX = clamp(this._keyAimX, -1.2, 1.2);
    this._keyAimY = clamp(this._keyAimY, -1.2, 1.2);
    if (code === 'Space' && this._state === 'aiming' && Date.now() - this._aimStart >= AIM_MIN) {
      this._doThrow();
    }
  }

  update(dt) {
    if (!this.running) return;

    if (this._flash) {
      this._flash.t -= dt;
      if (this._flash.t <= 0) this._flash = null;
    }

    if (this._state === 'aiming') {
      // Update aim position
      if (this.triki.connected) {
        this._aimX = clamp(-this.triki.GZ(0) / AIM_S, -1.3, 1.3);
        this._aimY = clamp( this.triki.GX(0) / AIM_S, -1.3, 1.3);
      } else if (this._keyAimX !== 0 || this._keyAimY !== 0) {
        this._aimX = this._keyAimX;
        this._aimY = this._keyAimY;
      } else {
        // Mouse aim: map mouse [0,1] → normalized [-1,1] board space
        const S = Math.min(this.W, this.H);
        const R = S * 0.40;
        this._aimX = clamp((this._mx - 0.5) * this.W / R, -1.3, 1.3);
        this._aimY = clamp((this._my - 0.5) * this.H / R, -1.3, 1.3);
      }

      // Wobble: variance of recent aim positions
      this._aimBuf.push({ x: this._aimX, y: this._aimY });
      if (this._aimBuf.length > 25) this._aimBuf.shift();
      if (this._aimBuf.length >= 6) {
        const mx = this._aimBuf.reduce((s,p) => s+p.x, 0) / this._aimBuf.length;
        const my = this._aimBuf.reduce((s,p) => s+p.y, 0) / this._aimBuf.length;
        const vr = this._aimBuf.reduce((s,p) => s+(p.x-mx)**2+(p.y-my)**2, 0) / this._aimBuf.length;
        this._wobble = clamp(Math.sqrt(vr) * 6, 0.015, 0.45);
      }

      // Throw detection (BLE only)
      if (this.triki.connected && Date.now() - this._aimStart >= AIM_MIN) {
        const g = Math.hypot(this.triki.ax, this.triki.ay, this.triki.az);
        if (g >= THROW_G) this._doThrow();
      }

    } else if (this._state === 'result') {
      this._resultT -= dt;
      if (this._resultT <= 0) {
        if (this._throwN >= THROWS) {
          this.running = false;
          this.emit('end', { score: this._total });
        } else {
          this._state    = 'aiming';
          this._aimStart = Date.now();
          this._aimBuf   = [];
        }
      }
    }
  }

  _doThrow() {
    if (this._state !== 'aiming') return;
    const score = this._calcScore(this._aimX, this._aimY);
    this._darts.push({ nx: this._aimX, ny: this._aimY, ...score });
    this._throwN++;
    this._total += score.pts;
    this._flash  = { ...score, t: 1600 };
    this._state  = 'result';
    this._resultT = 1600;
    this.emit('stats', `${this._throwN}/${THROWS} — <b>${this._total} pkt</b>`);
  }

  _calcScore(nx, ny) {
    const r = Math.hypot(nx, ny);
    if (r <= RR.bull)   return { pts:50, label:'BULLSEYE!', color:'#f87171' };
    if (r <= RR.inner)  return { pts:25, label:'BULL',      color:'#4ade80' };
    if (r >  RR.dblOut) return { pts: 0, label:'PUDŁO',     color:'#6b7280' };

    // Angle from top, clockwise; +π/20 offset so sector 20 is centered at top
    const ang = ((Math.atan2(nx, -ny) + Math.PI / 20 + Math.PI * 4) % (Math.PI * 2));
    const idx  = Math.floor(ang / (Math.PI * 2) * 20) % 20;
    const val  = SECTORS[idx];
    const even = idx % 2 === 0;

    if (r >= RR.triIn && r <= RR.triOut)
      return { pts: val*3, label: `TRIPLE ${val}`, color: even ? '#4ade80' : '#f87171' };
    if (r >= RR.dblIn && r <= RR.dblOut)
      return { pts: val*2, label: `DOUBLE ${val}`, color: even ? '#4ade80' : '#f87171' };
    return { pts: val, label: `${val}`, color: even ? '#e5e5e0' : '#9ca3af' };
  }

  // ── Drawing ───────────────────────────────────────────────

  draw() {
    const { ctx, W, H } = this;
    const S  = Math.min(W, H);
    const cx = W/2, cy = H/2;
    const R  = S * 0.40;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, W, H);

    this._drawBoard(cx, cy, R);
    this._drawDarts(cx, cy, R);
    if (this._state === 'aiming' || this._state === 'result')
      this._drawCrosshair(cx, cy, R);
    if (this._flash)
      this._drawFlash(W, H);
    this._drawHUD(W, H);
  }

  _drawBoard(cx, cy, R) {
    const ctx  = this.ctx;
    const step = Math.PI * 2 / 20;

    // Outer miss ring
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.08, 0, Math.PI*2);
    ctx.fillStyle = '#0d0d0d'; ctx.fill();
    ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 1; ctx.stroke();

    // 20 sectors: outer single → triple → inner single → double
    for (let i = 0; i < 20; i++) {
      const even = i % 2 === 0;
      const a0   = -Math.PI/2 + i*step - step/2;
      const a1   = a0 + step;
      this._wedge(cx,cy, R*RR.inner,  R*RR.triIn,  a0, a1, even ? '#d6cfc2' : '#0d0d0d');
      this._wedge(cx,cy, R*RR.triIn,  R*RR.triOut, a0, a1, even ? '#16a34a' : '#dc2626');
      this._wedge(cx,cy, R*RR.triOut, R*RR.dblIn,  a0, a1, even ? '#d6cfc2' : '#0d0d0d');
      this._wedge(cx,cy, R*RR.dblIn,  R*RR.dblOut, a0, a1, even ? '#16a34a' : '#dc2626');
    }

    // Thin wire dividers
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.5;
    for (let i = 0; i < 20; i++) {
      const a = -Math.PI/2 + i*step - step/2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a)*R*RR.inner,  cy + Math.sin(a)*R*RR.inner);
      ctx.lineTo(cx + Math.cos(a)*R*RR.dblOut, cy + Math.sin(a)*R*RR.dblOut);
      ctx.stroke();
    }

    // Bull (green) + Bullseye (red)
    ctx.beginPath(); ctx.arc(cx, cy, R*RR.inner, 0, Math.PI*2);
    ctx.fillStyle = '#16a34a'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, R*RR.bull, 0, Math.PI*2);
    ctx.fillStyle = '#dc2626'; ctx.fill();

    // Numbers
    const fSize  = Math.max(9, Math.round(R * 0.095));
    const numR   = R * 1.035 + fSize * 0.65;
    ctx.font = `bold ${fSize}px Outfit,sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < 20; i++) {
      const a = -Math.PI/2 + i*step;
      ctx.fillStyle = '#fff';
      ctx.fillText(SECTORS[i], cx + Math.cos(a)*numR, cy + Math.sin(a)*numR);
    }
  }

  _wedge(cx, cy, r1, r2, a0, a1, color) {
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, r2, a0, a1);
    this.ctx.arc(cx, cy, r1, a1, a0, true);
    this.ctx.closePath();
    this.ctx.fillStyle = color;
    this.ctx.fill();
  }

  _drawDartPin(cx, cy, R, nx, ny) {
    const ctx = this.ctx;
    const px  = cx + nx*R, py = cy + ny*R;
    ctx.beginPath(); ctx.arc(px+1, py+1, 5, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fill();
    ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI*2);
    ctx.fillStyle = '#fbbf24'; ctx.fill();
    ctx.beginPath(); ctx.arc(px, py, 2, 0, Math.PI*2);
    ctx.fillStyle = '#fff'; ctx.fill();
  }

  _drawDarts(cx, cy, R) {
    for (const d of this._darts) {
      // Impact ring for the last dart thrown
      if (d === this._darts[this._darts.length - 1] && this._flash) {
        const px = cx + d.nx*R, py = cy + d.ny*R;
        const progress = 1 - clamp(this._flash.t / 300, 0, 1);
        const ringR    = 12 + progress * 18;
        const alpha    = (1 - progress) * 0.7;
        this.ctx.beginPath(); this.ctx.arc(px, py, ringR, 0, Math.PI*2);
        this.ctx.strokeStyle = `rgba(251,191,36,${alpha})`;
        this.ctx.lineWidth = 2; this.ctx.stroke();
      }
      this._drawDartPin(cx, cy, R, d.nx, d.ny);
    }
  }

  _drawCrosshair(cx, cy, R) {
    const ctx    = this.ctx;
    const px     = cx + this._aimX*R, py = cy + this._aimY*R;
    const wr     = this._wobble * R;
    const stable = this._wobble < 0.06;

    // Wobble ring
    ctx.beginPath(); ctx.arc(px, py, wr, 0, Math.PI*2);
    ctx.strokeStyle = stable ? 'rgba(74,222,128,0.70)' : 'rgba(251,191,36,0.60)';
    ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);

    // Crosshair lines (with gap)
    const cl = Math.max(6, Math.min(18, wr * 0.5));
    ctx.strokeStyle = 'rgba(255,255,255,0.90)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px-cl-4, py); ctx.lineTo(px-4, py);
    ctx.moveTo(px+4,    py); ctx.lineTo(px+cl+4, py);
    ctx.moveTo(px, py-cl-4); ctx.lineTo(px, py-4);
    ctx.moveTo(px, py+4);    ctx.lineTo(px, py+cl+4);
    ctx.stroke();

    // Center dot
    ctx.beginPath(); ctx.arc(px, py, 2.5, 0, Math.PI*2);
    ctx.fillStyle = '#fff'; ctx.fill();
  }

  _drawFlash(W, H) {
    const ctx = this.ctx;
    const t   = this._flash.t;
    const a   = clamp(t / 400, 0, 1);

    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const fBase = Math.round(W * 0.048);

    ctx.font = `700 ${fBase}px Outfit,sans-serif`;
    ctx.globalAlpha = a * 0.95;
    ctx.fillStyle = this._flash.color;
    ctx.fillText(this._flash.label, W/2, H * 0.13);

    ctx.font = `900 ${Math.round(fBase * 1.55)}px Outfit,sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.fillText(`+${this._flash.pts}`, W/2, H * 0.13 + fBase * 1.6);
    ctx.restore();
  }

  _drawHUD(W, H) {
    const ctx = this.ctx;
    // Score total
    if (this._throwN > 0) {
      ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.font = `700 ${Math.round(W * 0.038)}px Outfit,sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(`${this._total} pkt`, W - 10, 8);
    }

    // Throw-counter dots at bottom
    const dotR = 7, gap = 22;
    const dotY  = H - 16;
    const startX = W/2 - (THROWS-1) * gap / 2;
    for (let i = 0; i < THROWS; i++) {
      const x = startX + i * gap;
      ctx.beginPath(); ctx.arc(x, dotY, dotR, 0, Math.PI*2);
      if (i < this._throwN) {
        const d = this._darts[i];
        ctx.fillStyle = d.pts >= 50 ? '#dc2626'
                      : d.pts >= 25 ? '#16a34a'
                      : d.pts > 0  ? '#fbbf24'
                      : '#374151';
      } else if (i === this._throwN) {
        ctx.fillStyle = '#fff';
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
      }
      ctx.fill();
    }

    // Aim status hint
    if (this._state === 'aiming' && Date.now() - this._aimStart >= AIM_MIN) {
      const stable = this._wobble < 0.07;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.font = `600 ${Math.round(W * 0.037)}px Outfit,sans-serif`;
      ctx.fillStyle = stable ? 'rgba(74,222,128,0.90)' : 'rgba(251,191,36,0.75)';
      ctx.fillText(
        stable ? '⚡ Rzuć kapslem!' : '🎯 Celuj i ustabilizuj...',
        W/2, dotY - dotR - 5
      );
    } else if (this._state === 'aiming' && Date.now() - this._aimStart < AIM_MIN) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.font = `600 ${Math.round(W * 0.037)}px Outfit,sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText('Celuj...', W/2, dotY - dotR - 5);
    }
  }

  drawIdle() {
    const { W, H } = this;
    const S  = Math.min(W, H);
    const cx = W/2, cy = H/2;
    const R  = S * 0.40;

    this.ctx.clearRect(0, 0, W, H);
    this.ctx.fillStyle = '#0a0c10';
    this.ctx.fillRect(0, 0, W, H);

    this._drawBoard(cx, cy, R);
    this._drawDartPin(cx, cy, R, -0.05, -0.04);
    this._drawDartPin(cx, cy, R, -0.37,  0.20);
    this._drawDartPin(cx, cy, R,  0.22, -0.52);
  }

  destroy() { this.running = false; }
}
