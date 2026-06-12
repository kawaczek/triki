import { clamp } from '../../static/gameutils.js';

const MIN_BPM   = 40;
const MAX_BPM   = 220;
const TAP_WIN   = 3000;  // ms — zapomnij tap po 3s ciszy
const MIN_TAPS  = 2;     // ile tapów do obliczenia BPM
const SHAKE_G   = 1.28;
const SHAKE_DEB = 120;   // ms min między tap-shake

export default class MetronomGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas;
    this.ctx    = ctx;
    this.triki  = triki;
    this.emit   = emit;

    this._bpm     = 120;
    this._taps    = [];      // timestamps ostatnich tapów
    this._playing = false;
    this._beat    = 0;       // numer bitu (modulo 4)
    this._beatT   = 0;       // czas do następnego bitu (ms)
    this._flash   = 0;       // jasność flesza po bicie [0..1]
    this._t       = 0;
    this._prevG   = 0;
    this._lastTap = -9999;
    this._audioCtx = null;
    this._running  = false;
    this._tapFeedback = 0;   // animacja po tapie
    this._bpmSmooth   = 120; // wyświetlany BPM (lekko wygładzony)
  }

  start() {
    this._running = true;
    this._playing = false;
    this._taps    = [];
    this._beat    = 0;
    this._beatT   = 60000 / this._bpm;
    this._t       = 0;
    this._prevG   = 0;
    this._lastTap = -9999;
    try { this._audioCtx = new AudioContext(); } catch(_) {}
  }

  stop() { this._running = false; }
  resize() {}

  _tap(now) {
    // Usuń stare taps
    const cutoff = now - TAP_WIN;
    this._taps = this._taps.filter(t => t > cutoff);
    this._taps.push(now);
    this._tapFeedback = 1;

    if (this._taps.length >= MIN_TAPS) {
      const intervals = [];
      for (let i = 1; i < this._taps.length; i++)
        intervals.push(this._taps[i] - this._taps[i-1]);
      const avg = intervals.reduce((a,b) => a+b, 0) / intervals.length;
      this._bpm = clamp(Math.round(60000 / avg), MIN_BPM, MAX_BPM);
      // Zresetuj timer bicia do nowego BPM
      this._beatT   = 60000 / this._bpm;
      this._playing = true;
    }
    this._lastTap = now;
  }

  _playClick(accent) {
    if (!this._audioCtx) return;
    try {
      const osc = this._audioCtx.createOscillator();
      const g   = this._audioCtx.createGain();
      osc.connect(g); g.connect(this._audioCtx.destination);
      osc.frequency.value = accent ? 1000 : 660;
      osc.type = 'sine';
      const t = this._audioCtx.currentTime;
      g.gain.setValueAtTime(accent ? 0.5 : 0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      osc.start(t); osc.stop(t + 0.07);
    } catch(_) {}
  }

  update(dt) {
    this._t += dt;
    if (!this._running) return;

    // Beat tick
    if (this._playing) {
      this._beatT -= dt;
      if (this._beatT <= 0) {
        const beatMs = 60000 / this._bpm;
        this._beatT += beatMs;
        this._beat  = (this._beat + 1) % 4;
        this._flash = 1;
        this._playClick(this._beat === 0);
      }
      this._flash = Math.max(0, this._flash - dt * 0.005);
    }

    this._tapFeedback = Math.max(0, this._tapFeedback - dt * 0.004);
    this._bpmSmooth += (this._bpm - this._bpmSmooth) * Math.min(1, dt * 0.01);

    // BLE: shake = tap
    const gf = Math.hypot(this.triki.ax, this.triki.ay, this.triki.az);
    if (gf >= SHAKE_G && this._prevG < SHAKE_G && this._t - this._lastTap > SHAKE_DEB) {
      this._tap(this._t);
    }
    this._prevG = gf;

    // BLE: button = tap
    if (this.triki.consumeClick?.() && this._t - this._lastTap > SHAKE_DEB) {
      this._tap(this._t);
    }
  }

  draw() {
    const { width: W, height: H } = this.canvas;
    const ctx = this.ctx;
    const CX = W / 2, CY = H / 2;

    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, W, H);

    // Flash tła przy biciu
    if (this._flash > 0) {
      const isAccent = this._beat === 0;
      ctx.fillStyle = isAccent
        ? `rgba(168,85,247,${this._flash * 0.12})`
        : `rgba(255,255,255,${this._flash * 0.05})`;
      ctx.fillRect(0, 0, W, H);
    }

    // Pulsujący okrąg metronomu
    const beatMs  = 60000 / this._bpm;
    const beatProg = this._playing ? 1 - Math.max(0, this._beatT / beatMs) : 0;
    const pulse    = this._playing ? 0.85 + 0.15 * Math.sin(beatProg * Math.PI) : 0.85;
    const R        = Math.min(W, H) * 0.26 * pulse;
    const beatCol  = this._beat === 0 ? '#a855f7' : '#6366f1';

    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, Math.PI * 2);
    ctx.strokeStyle = this._playing ? beatCol : 'rgba(255,255,255,0.15)';
    ctx.lineWidth   = 3;
    ctx.shadowBlur  = this._playing ? 20 : 0;
    ctx.shadowColor = beatCol;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Wypełnienie przy biciu
    if (this._flash > 0) {
      ctx.beginPath();
      ctx.arc(CX, CY, R * this._flash * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = this._beat === 0
        ? `rgba(168,85,247,${this._flash * 0.3})`
        : `rgba(99,102,241,${this._flash * 0.2})`;
      ctx.fill();
    }

    // BPM
    const bpmDisplay = Math.round(this._bpmSmooth);
    ctx.fillStyle = '#fff';
    ctx.font = `900 ${Math.round(W * 0.2)}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(bpmDisplay, CX, CY);
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = `${Math.round(W * 0.042)}px Outfit, sans-serif`;
    ctx.fillText('BPM', CX, CY + Math.round(W * 0.115));

    // Nazwa tempa
    const tempoName = this._tempoName(this._bpm);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = `${Math.round(W * 0.038)}px Outfit, sans-serif`;
    ctx.fillText(tempoName, CX, CY - Math.round(W * 0.13));

    // Przyciski +/-
    const btnY = CY + Math.round(W * 0.22);
    const btnR = Math.round(W * 0.1);
    [[-1, '−'], [1, '+']].forEach(([dir, label]) => {
      const bx = CX + dir * W * 0.28;
      ctx.beginPath();
      ctx.arc(bx, btnY, btnR, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = `bold ${Math.round(W * 0.07)}px Outfit, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillText(label, bx, btnY);
    });
    ctx.textBaseline = 'alphabetic';

    // Uderzenia (kropki bitu)
    const dotsY = CY - Math.round(W * 0.27);
    for (let i = 0; i < 4; i++) {
      const x  = CX + (i - 1.5) * W * 0.1;
      const on = this._playing && i === this._beat;
      ctx.beginPath();
      ctx.arc(x, dotsY, on ? 9 : 6, 0, Math.PI * 2);
      ctx.fillStyle = on ? (i === 0 ? '#a855f7' : '#fff') : 'rgba(255,255,255,0.2)';
      ctx.shadowBlur = on ? 12 : 0;
      ctx.shadowColor = '#a855f7';
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Tap feedback
    if (this._tapFeedback > 0) {
      ctx.fillStyle = `rgba(168,85,247,${this._tapFeedback * 0.6})`;
      ctx.font = `bold ${Math.round(W * 0.055)}px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('TAP', CX, CY - R - 20);
    }

    // Podpowiedź
    if (!this._playing && this._taps.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = `${Math.round(W * 0.038)}px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('tap w rytm żeby ustawić BPM', CX, H - 28);
    } else if (!this._playing && this._taps.length === 1) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = `${Math.round(W * 0.038)}px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('kontynuuj tapowanie…', CX, H - 28);
    }
  }

  _tempoName(bpm) {
    if (bpm < 60)  return 'Grave';
    if (bpm < 66)  return 'Largo';
    if (bpm < 76)  return 'Adagio';
    if (bpm < 108) return 'Andante';
    if (bpm < 120) return 'Moderato';
    if (bpm < 156) return 'Allegro';
    if (bpm < 176) return 'Vivace';
    if (bpm < 200) return 'Presto';
    return 'Prestissimo';
  }

  onClick(nx, ny) {
    if (!this._running) return;
    // Kliknięcie w przyciski +/-
    const { width: W, height: H } = this.canvas;
    const CX = W / 2, CY = H / 2;
    const btnY = CY + W * 0.22;
    const btnR = W * 0.1;
    const px = nx * W, py = ny * H;
    if (Math.hypot(px - (CX - W * 0.28), py - btnY) < btnR + 10) {
      this._bpm = clamp(this._bpm - 5, MIN_BPM, MAX_BPM);
      this._playing = true; this._taps = []; return;
    }
    if (Math.hypot(px - (CX + W * 0.28), py - btnY) < btnR + 10) {
      this._bpm = clamp(this._bpm + 5, MIN_BPM, MAX_BPM);
      this._playing = true; this._taps = []; return;
    }
    this._tap(this._t);
  }

  onKeyDown(code) {
    if (code === 'Space')      this._tap(this._t);
    if (code === 'ArrowUp')    this._bpm = clamp(this._bpm + 5,  MIN_BPM, MAX_BPM);
    if (code === 'ArrowDown')  this._bpm = clamp(this._bpm - 5,  MIN_BPM, MAX_BPM);
    if (code === 'ArrowRight') this._bpm = clamp(this._bpm + 1,  MIN_BPM, MAX_BPM);
    if (code === 'ArrowLeft')  this._bpm = clamp(this._bpm - 1,  MIN_BPM, MAX_BPM);
    if (code === 'KeyR') { this._playing = false; this._taps = []; this._beat = 0; }
  }

  onMouseMove() {}
  onKeyUp() {}
}
