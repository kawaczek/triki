const FREQ_MIN = 80, FREQ_MAX = 1200;
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

export default class ThereminGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas; this.ctx = ctx; this.triki = triki; this.emit = emit;
    this._audioCtx = null;
    this._osc      = null;
    this._gain     = null;
    this._muted    = false;
    this._freq     = 440;
    this._vol      = 0.5;
    this._mx       = 0.5; this._my = 0.5;
    this._kFreqDir = 0;
    this._t        = 0; this._running = false;
    this._wave     = new Float32Array(64).fill(0);
  }

  start() {
    this._running = true;
    try {
      this._audioCtx = new AudioContext();
      this._osc  = this._audioCtx.createOscillator();
      this._gain = this._audioCtx.createGain();
      this._osc.connect(this._gain);
      this._gain.connect(this._audioCtx.destination);
      this._osc.type = 'sine';
      this._osc.frequency.value = 440;
      this._gain.gain.value = 0;
      this._osc.start();
    } catch(_) {}
  }

  stop() {
    this._running = false;
    try { this._osc?.stop(); this._audioCtx?.close(); } catch(_) {}
    this._osc = null; this._audioCtx = null;
  }
  destroy() { this.stop(); }
  resize()  {}

  _freqToNote(f) {
    const midi = Math.round(12 * Math.log2(f / 440) + 69);
    return NOTE_NAMES[((midi % 12) + 12) % 12] + Math.floor(midi / 12 - 1);
  }

  update(dt) {
    this._t += dt;
    if (!this._running) return;

    // Źródło sterowania
    let pitchNorm, volNorm;
    if (this.triki.connected) {
      pitchNorm = (this.triki.ax + 1) / 2;   // ax: -1..+1 → 0..1
      volNorm   = 1 - (this.triki.ay + 1) / 2; // ay: -1..+1 → odwrócony
    } else {
      pitchNorm = this._mx;
      volNorm   = 1 - this._my;
    }

    // Klawiatura
    this._mx = Math.max(0, Math.min(1, this._mx + this._kFreqDir * dt * 0.0006));
    if (this.triki.connected) pitchNorm = Math.max(0, Math.min(1, pitchNorm));

    // Freq: exponential mapping
    this._freq = FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, Math.max(0, Math.min(1, pitchNorm)));
    this._vol  = Math.max(0, Math.min(1, volNorm));

    // Update audio
    if (this._osc && this._audioCtx) {
      this._osc.frequency.setTargetAtTime(this._freq, this._audioCtx.currentTime, 0.02);
      const target = this._muted ? 0 : this._vol * 0.4;
      this._gain.gain.setTargetAtTime(target, this._audioCtx.currentTime, 0.03);
    }

    // Waveform visualization
    const v = this._muted ? 0 : this._vol;
    const waveAmp = v * Math.sin(this._t * this._freq * 0.002 * Math.PI * 2);
    this._wave.copyWithin(0, 1);
    this._wave[this._wave.length - 1] = waveAmp;

    // BLE button = mute toggle
    if (this.triki.consumeClick?.()) this._muted = !this._muted;
  }

  draw() {
    const { width: W, height: H } = this.canvas;
    const ctx = this.ctx;
    const CX = W/2;

    ctx.fillStyle = '#0a0c10'; ctx.fillRect(0, 0, W, H);

    const pitchCol = `hsl(${Math.round((1 - this._freq/FREQ_MAX) * 240)},80%,55%)`;

    // Fala dźwiękowa
    const waveY = H * 0.42, waveH = H * 0.22;
    ctx.beginPath();
    this._wave.forEach((v, i) => {
      const x = (i / (this._wave.length - 1)) * W;
      const y = waveY + v * waveH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = this._muted ? 'rgba(255,255,255,0.15)' : pitchCol;
    ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.shadowBlur = this._muted ? 0 : 14; ctx.shadowColor = pitchCol;
    ctx.stroke(); ctx.shadowBlur = 0;

    // Częstotliwość + nuta
    ctx.fillStyle = this._muted ? 'rgba(255,255,255,0.25)' : pitchCol;
    ctx.font = `900 ${Math.round(W * 0.18)}px Outfit, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowBlur = this._muted ? 0 : 20; ctx.shadowColor = pitchCol;
    ctx.fillText(`${Math.round(this._freq)} Hz`, CX, H * 0.2);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = `bold ${Math.round(W * 0.065)}px Outfit, sans-serif`;
    ctx.fillText(this._freqToNote(this._freq), CX, H * 0.2 + Math.round(W * 0.13));

    // Pasek głośności
    const volW = W * 0.6, volH = 10, volX = CX - volW/2, volY = H * 0.7;
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath(); ctx.roundRect(volX, volY, volW, volH, 5); ctx.fill();
    ctx.fillStyle = pitchCol;
    ctx.beginPath(); ctx.roundRect(volX, volY, volW * this._vol, volH, 5); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = `${Math.round(W * 0.032)}px Outfit, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(`głośność ${Math.round(this._vol * 100)}%`, CX, volY + 16);

    // Pasek tonacji
    const pW = W * 0.6, pX = CX - pW/2, pY = H * 0.78;
    const grd = ctx.createLinearGradient(pX, 0, pX+pW, 0);
    ['#3b82f6','#22c55e','#f59e0b','#ef4444'].forEach((c,i) => grd.addColorStop(i/3, c));
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.roundRect(pX, pY, pW, 10, 5); ctx.fill();
    const markerX = pX + pW * Math.log(this._freq/FREQ_MIN) / Math.log(FREQ_MAX/FREQ_MIN);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(markerX, pY+5, 8, 0, Math.PI*2); ctx.fill();

    // Mute
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = this._muted ? '#ef4444' : 'rgba(255,255,255,0.35)';
    ctx.font = `bold ${Math.round(W * 0.038)}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(this._muted ? '🔇 WYCISZONY · kliknij żeby włączyć' : '🔊 Graj · przycisk = wycisz', CX, H - 20);

    // Hint BLE
    if (!this.triki.connected) {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.font = `${Math.round(W * 0.032)}px Outfit, sans-serif`;
      ctx.fillText('bez kapsla: mysz X=tonacja Y=głośność', CX, H - 44);
    }
  }

  onClick(nx, ny) {
    const { width: W, height: H } = this.canvas;
    if (!this.triki.connected) { this._mx = nx; this._my = ny; }
    this._muted = !this._muted;
  }
  onMouseMove(nx, ny) { if (!this.triki.connected) { this._mx = nx; this._my = ny; } }
  onKeyDown(code) {
    if (code === 'Space')       this._muted = !this._muted;
    if (code === 'ArrowRight')  this._kFreqDir =  1;
    if (code === 'ArrowLeft')   this._kFreqDir = -1;
  }
  onKeyUp(code) { if (['ArrowLeft','ArrowRight'].includes(code)) this._kFreqDir = 0; }
}
