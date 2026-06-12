const SHAKE_G   = 1.28;
const SHAKE_DEB = 180;
const BTN_DEB   = 80;

export default class LicznikGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas; this.ctx = ctx; this.triki = triki; this.emit = emit;
    this._shake = 0; this._click = 0;
    this._prevG = 0; this._lastShake = -9999; this._lastBtn = -9999;
    this._t = 0; this._running = false;
    this._shakeAnim = 0; this._clickAnim = 0;
  }
  start()  { this._running = true; }
  stop()   { this._running = false; }
  resize() {}

  update(dt) {
    this._t += dt;
    this._shakeAnim = Math.max(0, this._shakeAnim - dt * 0.006);
    this._clickAnim = Math.max(0, this._clickAnim - dt * 0.006);
    if (!this._running) return;

    const g = Math.hypot(this.triki.ax, this.triki.ay, this.triki.az);
    if (g >= SHAKE_G && this._prevG < SHAKE_G && this._t - this._lastShake > SHAKE_DEB) {
      this._lastShake = this._t; this._shake++; this._shakeAnim = 1;
      navigator.vibrate?.(30);
    }
    this._prevG = g;

    if (this.triki.consumeClick?.() && this._t - this._lastBtn > BTN_DEB) {
      this._lastBtn = this._t; this._click++; this._clickAnim = 1;
      navigator.vibrate?.(30);
    }
  }

  draw() {
    const { width: W, height: H } = this.canvas;
    const ctx = this.ctx;
    const CX = W / 2, CY = H / 2;

    ctx.fillStyle = '#0a0c10'; ctx.fillRect(0, 0, W, H);

    // Linia podziału
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(CX, 60); ctx.lineTo(CX, H - 60); ctx.stroke();

    const drawCounter = (x, count, label, emoji, color, anim) => {
      const scale = 1 + anim * 0.18;
      ctx.save(); ctx.translate(x, CY - 20); ctx.scale(scale, scale);

      ctx.fillStyle = color;
      ctx.font = `900 ${Math.round(W * 0.22)}px Outfit, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowBlur = anim * 30; ctx.shadowColor = color;
      ctx.fillText(count, 0, 0);
      ctx.shadowBlur = 0;
      ctx.restore();

      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = `${Math.round(W * 0.038)}px Outfit, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(`${emoji} ${label}`, x, CY + Math.round(W * 0.14));
    };

    drawCounter(CX * 0.5, this._shake, 'potrząśnięcia', '🫙', '#22c55e', this._shakeAnim);
    drawCounter(CX * 1.5, this._click, 'kliknięcia', '👆', '#3b82f6', this._clickAnim);

    // Reset buttons
    const btnY = H - 44, btnW = W * 0.35, btnH = 32, btnR = 8;
    [[CX * 0.5, this._shake, '#22c55e'], [CX * 1.5, this._click, '#3b82f6']].forEach(([x, val, col]) => {
      ctx.fillStyle = val > 0 ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.02)';
      ctx.beginPath(); ctx.roundRect(x - btnW/2, btnY - btnH/2, btnW, btnH, btnR); ctx.fill();
      ctx.fillStyle = val > 0 ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)';
      ctx.font = `${Math.round(W * 0.032)}px Outfit, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('RESET', x, btnY);
    });
  }

  onClick(nx, ny) {
    const { width: W, height: H } = this.canvas;
    const px = nx * W, py = ny * H;
    const btnY = H - 44, btnH = 32, btnW = W * 0.35;
    const CX = W / 2;

    // Reset buttons
    if (Math.abs(py - btnY) < btnH / 2 + 8) {
      if (px < CX) this._shake = 0;
      else          this._click = 0;
      return;
    }
    // Click counter
    if (px > CX) { this._click++; this._clickAnim = 1; navigator.vibrate?.(30); }
    else          { this._shake++; this._shakeAnim = 1; navigator.vibrate?.(30); }
  }

  onKeyDown(code) {
    if (code === 'KeyZ') { this._shake++; this._shakeAnim = 1; }
    if (code === 'KeyX') { this._click++; this._clickAnim = 1; }
    if (code === 'KeyR') { this._shake = 0; this._click = 0; }
  }
  onKeyUp() {} onMouseMove() {}
}
