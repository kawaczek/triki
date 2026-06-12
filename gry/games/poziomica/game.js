import { clamp } from '../../static/gameutils.js';

const LEVEL_THR = 0.04;   // g — "poziomo" threshold
const SCALE     = 3.2;    // jak bardzo bąbelek ucieka przy przechyle

export default class PoziomicaGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas  = canvas;
    this.ctx     = ctx;
    this.triki   = triki;
    this.emit    = emit;

    this._ax = 0; this._ay = 0;  // symulacja bez kapsla
    this._kx = 0; this._ky = 0;  // klawiatura delta
    this._running = false;
    this._t = 0;
  }

  start()  { this._running = true; this._ax = 0; this._ay = 0; this._kx = 0; this._ky = 0; }
  stop()   { this._running = false; }
  resize() {}

  update(dt) {
    this._t += dt;
    if (!this._running) return;
    if (!this.triki.connected) {
      // klawiatura
      this._ax = clamp(this._ax + this._kx * dt * 0.002, -1, 1);
      this._ay = clamp(this._ay + this._ky * dt * 0.002, -1, 1);
    }
  }

  draw() {
    const { width: W, height: H } = this.canvas;
    const ctx = this.ctx;
    const ax = this.triki.connected ? this.triki.ax : this._ax;
    const ay = this.triki.connected ? this.triki.ay : this._ay;
    const level = Math.hypot(ax, ay) < LEVEL_THR;

    // Tło
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, W, H);

    const R  = Math.min(W, H) * 0.36;  // promień czary
    const CX = W / 2, CY = H / 2;

    // Pierścienie poziomu
    [1.0, 0.6, 0.3].forEach((frac, i) => {
      ctx.beginPath();
      ctx.arc(CX, CY, R * frac, 0, Math.PI * 2);
      ctx.strokeStyle = i === 0
        ? 'rgba(255,255,255,0.12)'
        : `rgba(255,255,255,${0.06 - i * 0.01})`;
      ctx.lineWidth = i === 0 ? 2 : 1;
      ctx.stroke();
    });

    // Krzyż
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(CX - R, CY); ctx.lineTo(CX + R, CY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(CX, CY - R); ctx.lineTo(CX, CY + R); ctx.stroke();

    // Pozycja bąbelka
    const bx = CX + clamp(ax * R * SCALE, -R + 22, R - 22);
    const by = CY + clamp(ay * R * SCALE, -R + 22, R - 22);

    const col   = level ? '#22c55e' : Math.hypot(ax, ay) < 0.15 ? '#f59e0b' : '#ef4444';
    const gsize = level ? 40 : 24;

    // Poświata bąbelka
    const grd = ctx.createRadialGradient(bx, by, 0, bx, by, gsize);
    grd.addColorStop(0, col + 'cc');
    grd.addColorStop(1, col + '00');
    ctx.beginPath(); ctx.arc(bx, by, gsize, 0, Math.PI * 2);
    ctx.fillStyle = grd; ctx.fill();

    // Bąbelek
    ctx.beginPath(); ctx.arc(bx, by, 18, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.shadowBlur = 20; ctx.shadowColor = col;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Połysk
    ctx.beginPath(); ctx.arc(bx - 5, by - 5, 7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fill();

    // Wartości liczbowe
    const tiltDeg = (Math.atan2(Math.hypot(ax, ay), 1) * 180 / Math.PI).toFixed(1);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = `${Math.round(W * 0.038)}px Outfit, monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(`ax ${ax >= 0 ? '+' : ''}${(ax).toFixed(3)}  ay ${ay >= 0 ? '+' : ''}${(ay).toFixed(3)}`, CX, CY + R + 32);

    // Status
    const statusY = CY - R - 28;
    if (level) {
      const pulse = 0.7 + 0.3 * Math.sin(this._t * 0.004);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#22c55e';
      ctx.font = `bold ${Math.round(W * 0.065)}px Outfit, sans-serif`;
      ctx.fillText('POZIOMO', CX, statusY);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = col;
      ctx.font = `bold ${Math.round(W * 0.055)}px Outfit, sans-serif`;
      ctx.fillText(`${tiltDeg}°`, CX, statusY);
    }

    // Wskaźnik osi przy braku BLE
    if (!this.triki.connected) {
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font = `${Math.round(W * 0.032)}px Outfit, sans-serif`;
      ctx.fillText('↕ strzałki = przechył', CX, H - 20);
    }
  }

  onMouseMove(nx, ny) {
    if (!this.triki.connected) {
      this._ax = (nx - 0.5) * 2;
      this._ay = (ny - 0.5) * 2;
    }
  }

  onClick() {}

  onKeyDown(code) {
    const s = 0.6;
    if (code === 'ArrowLeft')  this._kx = -s;
    if (code === 'ArrowRight') this._kx =  s;
    if (code === 'ArrowUp')    this._ky = -s;
    if (code === 'ArrowDown')  this._ky =  s;
  }

  onKeyUp(code) {
    if (['ArrowLeft','ArrowRight'].includes(code)) this._kx = 0;
    if (['ArrowUp','ArrowDown'].includes(code))    this._ky = 0;
  }
}
