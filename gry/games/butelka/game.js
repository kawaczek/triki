const SHAKE_G   = 1.28;
const SHAKE_DEB = 800;
const SPIN_DEC  = 0.0000025;
const MIN_VEL   = 0.007;
const COLORS    = ['#ef4444','#3b82f6','#22c55e','#f59e0b','#a855f7','#ec4899','#06b6d4','#f97316'];

export default class ButelkaGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas; this.ctx = ctx; this.triki = triki; this.emit = emit;
    this._players  = 4;
    this._angle    = 0;
    this._vel      = 0;
    this._spinning = false;
    this._winner   = null;
    this._winAlpha = 0;
    this._prevG    = 0; this._lastSpin = -9999; this._t = 0;
    this._running  = false;
  }
  start()  { this._running = true; this._winner = null; }
  stop()   { this._running = false; }
  resize() {}

  _spin() {
    if (this._spinning) return;
    this._vel     = MIN_VEL + Math.random() * 0.016;
    this._spinning = true;
    this._winner  = null;
    this._winAlpha = 0;
    this._lastSpin = this._t;
    navigator.vibrate?.(40);
  }

  _settle() {
    this._spinning = false;
    const norm = ((this._angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    this._winner = Math.floor(((Math.PI * 2 - norm) / (Math.PI * 2)) * this._players + 0.5) % this._players;
    navigator.vibrate?.([60, 40, 120]);
  }

  update(dt) {
    this._t += dt;
    this._winAlpha = Math.min(1, this._winAlpha + dt * 0.003);
    if (!this._running) return;

    if (this._spinning) {
      this._vel = Math.max(0, this._vel - SPIN_DEC * dt);
      this._angle += this._vel * dt;
      if (this._vel === 0) this._settle();
    }

    const g = Math.hypot(this.triki.ax, this.triki.ay, this.triki.az);
    if (g >= SHAKE_G && this._prevG < SHAKE_G && this._t - this._lastSpin > SHAKE_DEB) this._spin();
    this._prevG = g;

    if (this.triki.consumeClick?.()) {
      this._players = this._players % 8 + 1;
      this._winner = null;
    }
  }

  draw() {
    const { width: W, height: H } = this.canvas;
    const ctx = this.ctx;
    const CX = W/2, CY = H * 0.44;
    const R  = Math.min(W, H) * 0.34;

    ctx.fillStyle = '#0a0c10'; ctx.fillRect(0, 0, W, H);

    // Segmenty graczy
    const step = (Math.PI * 2) / this._players;
    for (let i = 0; i < this._players; i++) {
      const a0 = this._angle + i * step - Math.PI / 2;
      const a1 = a0 + step;
      ctx.beginPath(); ctx.moveTo(CX, CY); ctx.arc(CX, CY, R, a0, a1); ctx.closePath();
      ctx.fillStyle = COLORS[i % COLORS.length] + '22'; ctx.fill();
      ctx.strokeStyle = COLORS[i % COLORS.length]; ctx.lineWidth = 2; ctx.stroke();

      // Numer gracza
      const mid = a0 + step/2;
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.font = `bold ${Math.round(R * 0.28)}px Outfit, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`P${i+1}`, CX + Math.cos(mid)*R*0.65, CY + Math.sin(mid)*R*0.65);
    }

    // Koło obwód
    ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI*2);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 3; ctx.stroke();

    // Butelka (wskaźnik)
    const bLen = R * 0.85;
    ctx.save(); ctx.translate(CX, CY); ctx.rotate(this._angle);
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.lineTo(0, -bLen);
    ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.shadowBlur = 16; ctx.shadowColor = '#22c55e'; ctx.stroke(); ctx.shadowBlur = 0;
    // Grrot
    ctx.beginPath(); ctx.arc(0, -bLen, 10, 0, Math.PI*2);
    ctx.fillStyle = '#22c55e'; ctx.fill();
    // Drugi koniec
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, bLen * 0.3);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 4; ctx.stroke();
    ctx.restore();

    // Środek
    ctx.beginPath(); ctx.arc(CX, CY, 12, 0, Math.PI*2);
    ctx.fillStyle = '#fff'; ctx.fill();

    // Wynik
    if (this._winner !== null && !this._spinning && this._winAlpha > 0) {
      ctx.globalAlpha = this._winAlpha;
      const col = COLORS[this._winner % COLORS.length];
      ctx.fillStyle = col;
      ctx.font = `900 ${Math.round(W * 0.12)}px Outfit, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowBlur = 24; ctx.shadowColor = col;
      ctx.fillText(`GRACZ ${this._winner + 1}`, CX, H * 0.83);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }

    // Liczba graczy + instrukcja
    const ctrlY = H - 36;
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = `${Math.round(W * 0.036)}px Outfit, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${this._players} graczy · kliknij przycisk żeby zmienić`, CX, ctrlY);
    if (!this._spinning && this._winner === null) {
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillText('potrząśnij kapslem lub kliknij żeby zakręcić', CX, ctrlY - 24);
    }
  }

  onClick(nx, ny) {
    if (!this._running) return;
    this._spin();
  }

  onKeyDown(code) {
    if (code === 'Space') this._spin();
    if (code === 'Equal' || code === 'NumpadAdd')    this._players = Math.min(8, this._players + 1);
    if (code === 'Minus' || code === 'NumpadSubtract') this._players = Math.max(2, this._players - 1);
    this._winner = null;
  }
  onKeyUp() {} onMouseMove() {}
}
