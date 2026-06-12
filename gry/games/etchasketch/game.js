const SHAKE_G   = 2.0;
const SHAKE_DEB = 500;
const SPEED     = 0.4;   // px/ms per unit tilt
const COLORS    = ['#22c55e','#3b82f6','#ef4444','#f59e0b','#a855f7','#ffffff','#06b6d4','#f97316'];

export default class EtchASketchGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas; this.ctx = ctx; this.triki = triki; this.emit = emit;
    this._x      = 0.5; this._y = 0.5;  // normalized position
    this._colIdx = 0;
    this._prevG  = 0; this._lastShake = -9999; this._t = 0;
    this._running = false;
    this._mouseMode = false;
    this._kx = 0; this._ky = 0;
    // Offscreen canvas for persistent drawing
    this._buf = document.createElement('canvas');
    this._bctx = this._buf.getContext('2d');
    this._dirty = true;  // needs buf resize
  }

  start() {
    this._running = true;
    this._x = 0.5; this._y = 0.5;
    this._dirty = true;
  }
  stop()   { this._running = false; }

  resize(W, H) {
    // Copy existing drawing to new size (scale)
    const tmp = document.createElement('canvas');
    tmp.width = this._buf.width || W; tmp.height = this._buf.height || H;
    const tc = tmp.getContext('2d'); tc.drawImage(this._buf, 0, 0);
    this._buf.width = W; this._buf.height = H;
    this._bctx.fillStyle = '#0a0c10'; this._bctx.fillRect(0, 0, W, H);
    this._bctx.drawImage(tmp, 0, 0, W, H);
    this._dirty = false;
  }

  _clear() {
    const { width: W, height: H } = this.canvas;
    this._bctx.fillStyle = '#0a0c10'; this._bctx.fillRect(0, 0, W, H);
    navigator.vibrate?.([80, 30, 80]);
  }

  _drawDot(nx, ny, color) {
    const { width: W, height: H } = this.canvas;
    this._bctx.beginPath();
    this._bctx.arc(nx * W, ny * H, 2.5, 0, Math.PI * 2);
    this._bctx.fillStyle = color;
    this._bctx.fill();
  }

  update(dt) {
    this._t += dt;
    if (!this._running) return;

    const { width: W, height: H } = this.canvas;
    if (this._dirty || this._buf.width !== W) { this.resize(W, H); }

    let dx = 0, dy = 0;
    if (this.triki.connected) {
      dx =  this.triki.ax * SPEED * dt / W;
      dy =  this.triki.ay * SPEED * dt / H;
    } else {
      dx = this._kx * SPEED * dt / W;
      dy = this._ky * SPEED * dt / H;
    }

    const px = this._x, py = this._y;
    this._x = Math.max(0, Math.min(1, this._x + dx));
    this._y = Math.max(0, Math.min(1, this._y + dy));

    if (Math.abs(dx) > 0.0001 || Math.abs(dy) > 0.0001) {
      const col = COLORS[this._colIdx];
      this._bctx.beginPath();
      this._bctx.moveTo(px * W, py * H);
      this._bctx.lineTo(this._x * W, this._y * H);
      this._bctx.strokeStyle = col;
      this._bctx.lineWidth   = 3;
      this._bctx.lineCap = 'round';
      this._bctx.stroke();
    }

    // Shake = clear
    const g = Math.hypot(this.triki.ax, this.triki.ay, this.triki.az);
    if (g >= SHAKE_G && this._prevG < SHAKE_G && this._t - this._lastShake > SHAKE_DEB) {
      this._lastShake = this._t; this._clear();
    }
    this._prevG = g;

    // Button = change color
    if (this.triki.consumeClick?.()) {
      this._colIdx = (this._colIdx + 1) % COLORS.length;
    }
  }

  draw() {
    const { width: W, height: H } = this.canvas;
    const ctx = this.ctx;

    // Copy buffer to screen
    ctx.drawImage(this._buf, 0, 0);

    // Cursor
    const col = COLORS[this._colIdx];
    ctx.beginPath(); ctx.arc(this._x * W, this._y * H, 6, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.shadowBlur = 10; ctx.shadowColor = col; ctx.fill(); ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(this._x * W, this._y * H, 9, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.5; ctx.stroke();

    // Color swatches
    const sw = 22, gap = 4, total = COLORS.length * (sw + gap) - gap;
    const startX = (W - total) / 2;
    COLORS.forEach((c, i) => {
      const bx = startX + i * (sw + gap);
      ctx.beginPath(); ctx.roundRect(bx, H - sw - 6, sw, sw, 4);
      ctx.fillStyle = i === this._colIdx ? c : c + '66'; ctx.fill();
      if (i === this._colIdx) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      }
    });

    // Hints
    if (!this.triki.connected) {
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font = `${Math.round(W * 0.032)}px Outfit, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('strzałki = rysuj · R = wyczyść · C = zmień kolor', W/2, 8);
      ctx.textBaseline = 'alphabetic';
    }
  }

  onClick(nx, ny) {
    const { width: W, height: H } = this.canvas;
    // Color swatches
    const sw = 22, gap = 4, total = COLORS.length * (sw + gap) - gap;
    const startX = (W - total) / 2;
    if (ny * H > H - sw - 10) {
      const i = Math.floor((nx * W - startX) / (sw + gap));
      if (i >= 0 && i < COLORS.length) { this._colIdx = i; return; }
    }
    // Move cursor to click
    if (!this.triki.connected) {
      this._x = nx; this._y = ny;
    }
    this._colIdx = (this._colIdx + 1) % COLORS.length;
  }

  onMouseMove(nx, ny) {
    if (!this.triki.connected) {
      const px = this._x, py = this._y;
      this._x = nx; this._y = ny;
      const { width: W, height: H } = this.canvas;
      this._bctx.beginPath();
      this._bctx.moveTo(px * W, py * H);
      this._bctx.lineTo(nx * W, ny * H);
      this._bctx.strokeStyle = COLORS[this._colIdx];
      this._bctx.lineWidth = 3; this._bctx.lineCap = 'round'; this._bctx.stroke();
    }
  }

  onKeyDown(code) {
    const s = 0.55;
    if (code === 'ArrowLeft')  this._kx = -s;
    if (code === 'ArrowRight') this._kx =  s;
    if (code === 'ArrowUp')    this._ky = -s;
    if (code === 'ArrowDown')  this._ky =  s;
    if (code === 'KeyR')       this._clear();
    if (code === 'KeyC')       this._colIdx = (this._colIdx + 1) % COLORS.length;
  }
  onKeyUp(code) {
    if (['ArrowLeft','ArrowRight'].includes(code)) this._kx = 0;
    if (['ArrowUp','ArrowDown'].includes(code))    this._ky = 0;
  }
}
