const SHAKE_G   = 1.30;
const SHAKE_DEB = 400;

export default class StoperGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas; this.ctx = ctx; this.triki = triki; this.emit = emit;
    this._state  = 'idle';  // idle | running | paused
    this._startT = 0; this._elapsed = 0;
    this._laps   = [];
    this._prevG  = 0; this._lastShake = -9999; this._t = 0;
    this._running = false;
  }
  start()  { this._running = true; }
  stop()   { this._running = false; }
  resize() {}

  _fmt(ms) {
    const m  = Math.floor(ms / 60000);
    const s  = Math.floor((ms % 60000) / 1000);
    const cs = Math.floor((ms % 1000) / 10);
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
  }

  _toggle() {
    if (this._state === 'idle' || this._state === 'paused') {
      this._state = 'running'; this._startT = performance.now() - this._elapsed;
    } else {
      this._state = 'paused'; this._elapsed = performance.now() - this._startT;
    }
    navigator.vibrate?.(25);
  }

  _lap() {
    if (this._state !== 'running') return;
    this._laps.unshift(performance.now() - this._startT);
    if (this._laps.length > 4) this._laps.pop();
    navigator.vibrate?.(15);
  }

  _reset() {
    this._state = 'idle'; this._elapsed = 0; this._laps = [];
  }

  update(dt) {
    this._t += dt;
    if (!this._running) return;
    if (this._state === 'running') this._elapsed = performance.now() - this._startT;

    const g = Math.hypot(this.triki.ax, this.triki.ay, this.triki.az);
    if (g >= SHAKE_G && this._prevG < SHAKE_G && this._t - this._lastShake > SHAKE_DEB) {
      this._lastShake = this._t; this._toggle();
    }
    this._prevG = g;

    if (this.triki.consumeClick?.()) this._lap();
  }

  draw() {
    const { width: W, height: H } = this.canvas;
    const ctx = this.ctx;
    const CX = W / 2;

    ctx.fillStyle = '#0a0c10'; ctx.fillRect(0, 0, W, H);

    // Timer
    const mainColor = this._state === 'running' ? '#22c55e' : this._state === 'paused' ? '#f59e0b' : '#fff';
    ctx.fillStyle = mainColor;
    ctx.font = `900 ${Math.round(W * 0.155)}px Outfit, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowBlur = this._state === 'running' ? 18 : 0; ctx.shadowColor = mainColor;
    ctx.fillText(this._fmt(this._elapsed), CX, H * 0.32);
    ctx.shadowBlur = 0;

    // Status
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = `${Math.round(W * 0.038)}px Outfit, sans-serif`;
    ctx.textBaseline = 'alphabetic';
    const statusTxt = this._state === 'running' ? '▶ DZIAŁA' : this._state === 'paused' ? '⏸ PAUZA' : '○ GOTOWY';
    ctx.fillText(statusTxt, CX, H * 0.32 + Math.round(W * 0.1));

    // Laps
    this._laps.forEach((lap, i) => {
      const y = H * 0.52 + i * (Math.round(W * 0.065) + 6);
      ctx.globalAlpha = 1 - i * 0.2;
      ctx.fillStyle = '#94a3b8';
      ctx.font = `${i === 0 ? 'bold ' : ''}${Math.round(W * 0.055)}px Outfit, monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(`Okrążenie ${this._laps.length - i}: ${this._fmt(lap)}`, CX, y);
      ctx.globalAlpha = 1;
    });

    // Buttons
    const btns = [
      { label: this._state === 'running' ? '⏸ PAUZA' : '▶ START', color: '#22c55e', x: CX - W * 0.28, action: 'toggle' },
      { label: '⏱ LAP',   color: '#3b82f6',  x: CX,            action: 'lap'    },
      { label: '↺ RESET', color: '#6b7280',  x: CX + W * 0.28, action: 'reset'  },
    ];
    btns.forEach(({ label, color, x }) => {
      ctx.beginPath(); ctx.arc(x, H - 60, 34, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill();
      ctx.strokeStyle = color + '66'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = `bold ${Math.round(W * 0.033)}px Outfit, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, x, H - 60);
    });
    ctx.textBaseline = 'alphabetic';

    // Hint
    if (this._state === 'idle') {
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font = `${Math.round(W * 0.034)}px Outfit, sans-serif`;
      ctx.fillText('potrząśnij = start', CX, H * 0.46);
    }
  }

  onClick(nx, ny) {
    const { width: W, height: H } = this.canvas;
    const px = nx * W, py = ny * H;
    if (Math.abs(py - (H - 60)) < 44) {
      if (px < W * 0.33)       this._toggle();
      else if (px < W * 0.67)  this._lap();
      else                      this._reset();
    } else this._toggle();
  }

  onKeyDown(code) {
    if (code === 'Space') this._toggle();
    if (code === 'KeyL')  this._lap();
    if (code === 'KeyR')  this._reset();
  }
  onKeyUp() {} onMouseMove() {}
}
