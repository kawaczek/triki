const SHAKE_G   = 1.28;
const SHAKE_DEB = 500;
const BEEP_INTERVAL = 600;

export default class MinutnikGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas; this.ctx = ctx; this.triki = triki; this.emit = emit;
    this._totalMs  = 5 * 60 * 1000;  // domyślnie 5 minut
    this._leftMs   = this._totalMs;
    this._state    = 'idle';    // idle | running | paused | done
    this._startT   = 0;
    this._prevG    = 0; this._lastShake = -9999; this._t = 0;
    this._beepT    = 0;
    this._doneFlash = 0;
    this._audioCtx = null;
    this._running  = false;
  }
  start()  { this._running = true; try { this._audioCtx = new AudioContext(); } catch(_) {} }
  stop()   { this._running = false; }
  resize() {}

  _beep(freq = 880, dur = 0.15) {
    if (!this._audioCtx) return;
    try {
      const o = this._audioCtx.createOscillator();
      const g = this._audioCtx.createGain();
      o.connect(g); g.connect(this._audioCtx.destination);
      o.frequency.value = freq; o.type = 'sine';
      const t = this._audioCtx.currentTime;
      g.gain.setValueAtTime(0.4, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.start(t); o.stop(t + dur);
    } catch(_) {}
  }

  _setTime(ms) { this._totalMs = ms; this._leftMs = ms; }

  _toggle() {
    if (this._state === 'done') { this._state = 'idle'; this._leftMs = this._totalMs; return; }
    if (this._state === 'idle' || this._state === 'paused') {
      this._state = 'running'; this._startT = performance.now();
    } else {
      this._state = 'paused'; this._leftMs -= performance.now() - this._startT;
    }
    navigator.vibrate?.(25);
  }

  _changeTime(deltaSec) {
    if (this._state !== 'idle') return;
    this._totalMs = Math.max(60000, Math.min(3600000, this._totalMs + deltaSec * 1000));
    this._leftMs  = this._totalMs;
  }

  update(dt) {
    this._t += dt;
    this._doneFlash = Math.max(0, this._doneFlash - dt * 0.003);
    if (!this._running) return;

    if (this._state === 'running') {
      this._leftMs = Math.max(0, this._totalMs - (performance.now() - this._startT));
      if (this._leftMs <= 0) {
        this._state = 'done'; this._leftMs = 0; this._doneFlash = 1;
        this._beepT = 0; navigator.vibrate?.([200, 100, 200, 100, 200]);
      }
    }

    if (this._state === 'done') {
      this._beepT += dt;
      if (this._beepT >= BEEP_INTERVAL) { this._beepT = 0; this._beep(880, 0.12); this._beep(1100, 0.09); this._doneFlash = 1; }
    }

    // BLE shake = toggle
    const g = Math.hypot(this.triki.ax, this.triki.ay, this.triki.az);
    if (g >= SHAKE_G && this._prevG < SHAKE_G && this._t - this._lastShake > SHAKE_DEB) {
      this._lastShake = this._t; this._toggle();
    }
    this._prevG = g;

    // BLE tilt L/R = change time (only when idle)
    if (this._state === 'idle') {
      const ax = this.triki.ax;
      if (Math.abs(ax) > 0.5) this._changeTime(ax > 0 ? 60 * dt * 0.001 : -60 * dt * 0.001);
    }
  }

  draw() {
    const { width: W, height: H } = this.canvas;
    const ctx = this.ctx;
    const CX = W / 2, CY = H * 0.38;

    ctx.fillStyle = '#0a0c10'; ctx.fillRect(0, 0, W, H);

    if (this._state === 'done' && this._doneFlash > 0) {
      ctx.fillStyle = `rgba(239,68,68,${this._doneFlash * 0.18})`; ctx.fillRect(0, 0, W, H);
    }

    // Kołowy progress
    const prog = this._state === 'idle' ? 1 : this._leftMs / this._totalMs;
    const R    = Math.min(W, H) * 0.3;
    ctx.beginPath(); ctx.arc(CX, CY, R, -Math.PI/2, -Math.PI/2 + Math.PI * 2, false);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 8; ctx.stroke();
    if (prog > 0) {
      const col = prog > 0.5 ? '#22c55e' : prog > 0.25 ? '#f59e0b' : '#ef4444';
      ctx.beginPath(); ctx.arc(CX, CY, R, -Math.PI/2, -Math.PI/2 + Math.PI * 2 * prog, false);
      ctx.strokeStyle = col; ctx.lineWidth = 8; ctx.lineCap = 'round';
      ctx.shadowBlur = 12; ctx.shadowColor = col; ctx.stroke(); ctx.shadowBlur = 0;
    }

    // Czas
    const ms   = this._leftMs;
    const m    = Math.floor(ms / 60000);
    const s    = Math.floor((ms % 60000) / 1000);
    const timeStr = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    const tCol = this._state === 'done' ? '#ef4444'
               : this._state === 'running' && ms < 60000 ? '#f59e0b' : '#fff';
    ctx.fillStyle = tCol;
    ctx.font = `900 ${Math.round(W * 0.175)}px Outfit, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowBlur = this._state === 'done' ? 24 : 0; ctx.shadowColor = '#ef4444';
    ctx.fillText(timeStr, CX, CY); ctx.shadowBlur = 0; ctx.textBaseline = 'alphabetic';

    // Status
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = `${Math.round(W * 0.038)}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    const statusMsg = this._state === 'done'    ? '🔔 KONIEC!' :
                      this._state === 'running' ? '▶ ODLICZA' :
                      this._state === 'paused'  ? '⏸ PAUZA'   : 'Ustaw czas';
    ctx.fillText(statusMsg, CX, CY + R + 28);

    // Przyciski +/- czasu (tylko idle)
    if (this._state === 'idle') {
      [[-1, '−5 min', CX - W*0.28], [1, '+5 min', CX + W*0.28]].forEach(([dir, lbl, bx]) => {
        ctx.beginPath(); ctx.arc(bx, H * 0.72, W * 0.1, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = `bold ${Math.round(W * 0.038)}px Outfit, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(lbl, bx, H * 0.72);
      });
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.font = `${Math.round(W * 0.032)}px Outfit, sans-serif`;
      ctx.fillText('lub pochyl kapsel żeby zmienić czas', CX, H * 0.82);
    }

    // START / PAUZA / RESET buttons
    const btn1lbl = this._state === 'running' ? '⏸ PAUZA' : this._state === 'done' ? '↺ NOWY' : '▶ START';
    const btn1col = this._state === 'done' ? '#6b7280' : '#22c55e';
    ctx.beginPath(); ctx.arc(CX, H - 56, 38, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill();
    ctx.strokeStyle = btn1col + '88'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = btn1col;
    ctx.font = `bold ${Math.round(W * 0.038)}px Outfit, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(btn1lbl, CX, H - 56);
    ctx.textBaseline = 'alphabetic';

    if (this._state !== 'idle') {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.font = `${Math.round(W * 0.032)}px Outfit, sans-serif`;
      ctx.fillText('potrząśnij = start/pauza', CX, H - 14);
    }
  }

  onClick(nx, ny) {
    const { width: W, height: H } = this.canvas;
    const px = nx * W, py = ny * H;
    if (this._state === 'idle') {
      if (Math.abs(py - H*0.72) < W*0.12) {
        if (px < W/2) this._changeTime(-5*60); else this._changeTime(5*60); return;
      }
    }
    this._toggle();
  }

  onKeyDown(code) {
    if (code === 'Space')       this._toggle();
    if (code === 'ArrowUp')     this._changeTime(60);
    if (code === 'ArrowDown')   this._changeTime(-60);
    if (code === 'ArrowRight')  this._changeTime(5*60);
    if (code === 'ArrowLeft')   this._changeTime(-5*60);
    if (code === 'KeyR')        { this._state = 'idle'; this._leftMs = this._totalMs; }
  }
  onKeyUp() {} onMouseMove() {}
}
