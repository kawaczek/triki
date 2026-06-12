const SHAKE_G   = 1.28;
const SHAKE_DEB = 700;
const COLORS    = ['#ef4444','#3b82f6','#22c55e','#f59e0b','#a855f7','#ec4899','#06b6d4','#f97316'];

export default class KtoNastepnyGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas; this.ctx = ctx; this.triki = triki; this.emit = emit;
    this._players = 4;
    this._winner  = null;
    this._animT   = 0; this._animDur = 1200; this._animating = false;
    this._highlighted = null;
    this._prevG   = 0; this._lastShake = -9999; this._t = 0;
    this._running = false;
  }
  start()  { this._running = true; }
  stop()   { this._running = false; }
  resize() {}

  _pick() {
    if (this._animating) return;
    this._winner = null; this._animating = true; this._animT = 0;
    navigator.vibrate?.(30);
  }

  update(dt) {
    this._t += dt;
    if (!this._running) return;

    if (this._animating) {
      this._animT += dt;
      const prog = this._animT / this._animDur;
      // Szybkie losowanie → zwalnia → wynik
      const speed = Math.max(1, Math.round((1 - prog) * 14 + 1));
      if (this._t % (speed * 16) < 20) {
        this._highlighted = Math.floor(Math.random() * this._players);
      }
      if (prog >= 1) {
        this._animating = false;
        this._winner = Math.floor(Math.random() * this._players);
        this._highlighted = this._winner;
        navigator.vibrate?.([80, 40, 150]);
      }
    }

    const g = Math.hypot(this.triki.ax, this.triki.ay, this.triki.az);
    if (g >= SHAKE_G && this._prevG < SHAKE_G && this._t - this._lastShake > SHAKE_DEB) {
      this._lastShake = this._t; this._pick();
    }
    this._prevG = g;

    if (this.triki.consumeClick?.()) {
      this._players = this._players % 8 + 1;
      this._winner = null; this._highlighted = null; this._animating = false;
    }
  }

  draw() {
    const { width: W, height: H } = this.canvas;
    const ctx = this.ctx;
    const CX = W/2, CY = H * 0.46;
    const R  = Math.min(W, H) * 0.32;

    ctx.fillStyle = '#0a0c10'; ctx.fillRect(0, 0, W, H);

    // Kółka graczy w okręgu
    for (let i = 0; i < this._players; i++) {
      const angle = (i / this._players) * Math.PI * 2 - Math.PI/2;
      const px    = CX + Math.cos(angle) * R;
      const py    = CY + Math.sin(angle) * R;
      const col   = COLORS[i % COLORS.length];
      const active = i === this._highlighted;
      const won    = !this._animating && i === this._winner;
      const dotR  = won ? 36 : active ? 32 : 24;

      if (active || won) {
        ctx.beginPath(); ctx.arc(px, py, dotR + 8, 0, Math.PI*2);
        ctx.fillStyle = col + '33'; ctx.fill();
        ctx.shadowBlur = won ? 28 : 14; ctx.shadowColor = col;
      }
      ctx.beginPath(); ctx.arc(px, py, dotR, 0, Math.PI*2);
      ctx.fillStyle = active || won ? col : col + '44'; ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = won ? '#fff' : active ? '#fff' : 'rgba(255,255,255,0.7)';
      ctx.font = `bold ${Math.round(dotR * 0.85)}px Outfit, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`P${i+1}`, px, py);
    }
    ctx.textBaseline = 'alphabetic';

    // Wynik środek
    if (this._winner !== null && !this._animating) {
      const col = COLORS[this._winner % COLORS.length];
      ctx.fillStyle = col;
      ctx.font = `900 ${Math.round(W * 0.095)}px Outfit, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowBlur = 24; ctx.shadowColor = col;
      ctx.fillText(`GRACZ ${this._winner+1}`, CX, CY);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = `${Math.round(W * 0.038)}px Outfit, sans-serif`;
      ctx.fillText('NASTĘPNY!', CX, CY + Math.round(W * 0.1));
    } else if (!this._animating) {
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.font = `${Math.round(W * 0.042)}px Outfit, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('?', CX, CY);
    }
    ctx.textBaseline = 'alphabetic';

    // Info
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.font = `${Math.round(W * 0.035)}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`${this._players} graczy · przycisk = zmień`, CX, H - 48);
    if (!this._animating && this._winner === null) {
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillText('potrząśnij lub kliknij żeby losować', CX, H - 24);
    }
  }

  onClick()  { this._pick(); }
  onKeyDown(code) {
    if (code === 'Space') this._pick();
    if (code === 'Equal' || code === 'NumpadAdd')      this._players = Math.min(8, this._players+1);
    if (code === 'Minus' || code === 'NumpadSubtract') this._players = Math.max(2, this._players-1);
    this._winner = null; this._highlighted = null; this._animating = false;
  }
  onKeyUp() {} onMouseMove() {}
}
