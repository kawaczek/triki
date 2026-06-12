import { clamp } from '../../static/gameutils.js';

const BPM       = 90;
const BEAT_MS   = 60000 / BPM;   // ~667ms
const FALL_BEATS = 2.5;
const FALL_MS   = FALL_BEATS * BEAT_MS;
const THROW_G   = 1.22;
const WIN_PERF  = 85;   // ±ms
const WIN_GOOD  = 210;  // ±ms
const DEBOUNCE  = 170;  // ms między uderzeniami

// Wzorzec: offsety beatów od pierwszej nuty (0 = pierwsza nuta)
// Nuta 0 pojawia się na starcie i dociera do strefy po FALL_BEATS beatach
const PAT = [
  0, 1, 2, 3, 4, 5, 6, 7,                                // bary 1-2: ćwierćnuty
  8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5,                    // bar 3: ósemki
  12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5,                // bar 4: ósemki
  16, 16.5, 17, 17.75, 18.5, 19, 19.5,                   // bar 5: synkopy
  20, 20.5, 21, 21.25, 21.75, 22, 22.5, 23, 23.5,        // bar 6: synkopy+
  24, 24.5, 24.75, 25, 25.5, 26, 26.5, 26.75, 27, 27.5,  // bar 7: gęsto
  28, 28.5, 29, 29.5, 30, 30.5, 31, 31.5,                // bar 8: finał
];
// hitTime w ms: nuta dociera do strefy po FALL_BEATS beatach od startu
const NOTES_TEMPLATE = PAT.map(b => (b + FALL_BEATS) * BEAT_MS);
const LAST_MS  = NOTES_TEMPLATE[NOTES_TEMPLATE.length - 1];
const GAME_MS  = LAST_MS + BEAT_MS * 3;

export default class RytmGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas;
    this.ctx    = ctx;
    this.triki  = triki;

    this._emit      = emit;
    this._raf       = null;
    this._startTime = 0;
    this._state     = 'idle';

    this._score    = 0;
    this._combo    = 0;
    this._maxCombo = 0;
    this._perf     = 0;
    this._good     = 0;
    this._miss     = 0;

    this._notes     = [];
    this._feedback  = null;   // {text, color, alpha, y}
    this._beatFlash = 0;
    this._lastBeatN = -1;
    this._lastHitT  = -9999;
    this._prevG     = 0;
    this._audioCtx  = null;
  }

  init(emit) { this._emit = emit; this.drawIdle(); }

  start() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._state     = 'playing';
    this._startTime = performance.now();
    this._score    = 0; this._combo = 0; this._maxCombo = 0;
    this._perf     = 0; this._good  = 0; this._miss     = 0;
    this._feedback = null; this._beatFlash = 0;
    this._lastBeatN = -1; this._lastHitT = -9999; this._prevG = 0;
    this._notes = NOTES_TEMPLATE.map(ht => ({ hitTime: ht, hit: null }));
    try { this._audioCtx = new AudioContext(); } catch(_) {}
    this._raf = requestAnimationFrame(() => this._tick());
  }

  stop() { if (this._raf) cancelAnimationFrame(this._raf); this._raf = null; }

  // ── helpers ──────────────────────────────────────────────────────────────

  _elapsed()  { return performance.now() - this._startTime; }
  _mult()     { return 1 + Math.floor(this._combo / 10); }

  _noteY(note) {
    const HZ = this.canvas.height * 0.78;
    const t  = clamp((this._elapsed() - (note.hitTime - FALL_MS)) / FALL_MS, 0, 1.3);
    return -40 + (HZ + 40) * t;
  }

  _doHit() {
    const elapsed = this._elapsed();
    if (elapsed - this._lastHitT < DEBOUNCE) return;
    this._lastHitT = elapsed;

    let best = null, bestDiff = Infinity;
    for (const n of this._notes) {
      if (n.hit) continue;
      const d = Math.abs(elapsed - n.hitTime);
      if (d < WIN_GOOD && d < bestDiff) { bestDiff = d; best = n; }
    }
    if (!best) return;

    const HZ = this.canvas.height * 0.78;
    if (bestDiff <= WIN_PERF) {
      best.hit = 'perfect';
      this._score += 100 * this._mult(); this._combo++; this._perf++;
      this._feedback = { text: 'PERFECT!', color: '#ffd700', alpha: 1, y: HZ - 20 };
    } else {
      best.hit = 'good';
      this._score += 50 * this._mult(); this._combo++; this._good++;
      this._feedback = { text: 'DOBRY', color: '#22d3ee', alpha: 1, y: HZ - 20 };
    }
    this._maxCombo  = Math.max(this._maxCombo, this._combo);
    this._beatFlash = Math.max(this._beatFlash, 0.9);
  }

  _playClick(accent) {
    if (!this._audioCtx) return;
    try {
      const osc = this._audioCtx.createOscillator();
      const g   = this._audioCtx.createGain();
      osc.connect(g); g.connect(this._audioCtx.destination);
      osc.frequency.value = accent ? 880 : 660;
      osc.type = 'sine';
      const t = this._audioCtx.currentTime;
      g.gain.setValueAtTime(accent ? 0.3 : 0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      osc.start(t); osc.stop(t + 0.09);
    } catch(_) {}
  }

  // ── game loop ─────────────────────────────────────────────────────────────

  _tick() {
    const elapsed = this._elapsed();
    const W = this.canvas.width, H = this.canvas.height;
    const HZ = H * 0.78;

    // Beat pulse + klik
    const beatN = Math.floor(elapsed / BEAT_MS);
    if (beatN > this._lastBeatN) {
      this._lastBeatN  = beatN;
      this._beatFlash  = Math.max(this._beatFlash, 0.45);
      this._playClick(beatN % 4 === 0);
    }

    // BLE: g-force spike (rosnące zbocze)
    const gf = Math.hypot(this.triki.ax, this.triki.ay, this.triki.az);
    if (gf >= THROW_G && this._prevG < THROW_G) this._doHit();
    this._prevG = gf;

    // BLE: przycisk kapsla
    if (this.triki.consumeClick?.()) this._doHit();

    // Auto-miss
    for (const n of this._notes) {
      if (!n.hit && elapsed > n.hitTime + WIN_GOOD + 60) {
        n.hit = 'miss'; this._combo = 0; this._miss++;
        if (!this._feedback || this._feedback.alpha < 0.5)
          this._feedback = { text: 'MISS', color: '#ef4444', alpha: 1, y: HZ - 20 };
      }
    }

    this._draw(W, H, HZ, elapsed);

    if (elapsed >= GAME_MS) {
      this._emit('end', {
        score: this._score,
        won: this._perf + this._good > this._miss,
      });
      return;
    }
    this._raf = requestAnimationFrame(() => this._tick());
  }

  // ── draw ─────────────────────────────────────────────────────────────────

  _drawScene(W, H, HZ, elapsed) {
    const ctx = this.ctx;
    const LW  = Math.min(W * 0.55, 200);
    const LX  = (W - LW) / 2;

    // Lane
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(LX, 0, LW, H);

    // Linie prowadzące
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(LX, 0); ctx.lineTo(LX, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(LX + LW, 0); ctx.lineTo(LX + LW, H); ctx.stroke();

    // Strefa uderzenia (zielony pas + okrąg)
    const grd = ctx.createLinearGradient(LX, 0, LX + LW, 0);
    grd.addColorStop(0,   'rgba(34,197,94,0)');
    grd.addColorStop(0.5, 'rgba(34,197,94,0.85)');
    grd.addColorStop(1,   'rgba(34,197,94,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(LX, HZ - 4, LW, 8);

    ctx.shadowBlur = 14; ctx.shadowColor = '#22c55e';
    ctx.strokeStyle = 'rgba(34,197,94,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(W / 2, HZ, 38, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;

    // Nuty
    for (const n of this._notes) {
      const y = elapsed !== undefined ? this._noteY(n) : H * 0.3 + this._notes.indexOf(n) * 80;
      if (y < -60 || y > H + 60) continue;
      if (n.hit === 'miss' && (elapsed === undefined || elapsed > n.hitTime + 500)) continue;

      let fill = '#fff', glow = 'rgba(255,255,255,0.5)';
      if (n.hit === 'perfect') { fill = '#ffd700'; glow = 'rgba(255,215,0,0.65)'; }
      else if (n.hit === 'good') { fill = '#22d3ee'; glow = 'rgba(34,211,238,0.5)'; }
      else if (n.hit === 'miss') { fill = 'rgba(239,68,68,0.3)'; glow = 'none'; }

      ctx.shadowBlur = 20; ctx.shadowColor = glow;
      ctx.fillStyle = fill;
      ctx.beginPath(); ctx.arc(W / 2, y, 27, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;

      if (!n.hit) {
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.beginPath(); ctx.arc(W / 2, y, 12, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  _draw(W, H, HZ, elapsed) {
    const ctx = this.ctx;

    // Tło
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, W, H);

    // Beat flash
    if (this._beatFlash > 0) {
      ctx.fillStyle = `rgba(168,85,247,${this._beatFlash * 0.06})`;
      ctx.fillRect(0, 0, W, H);
      this._beatFlash = Math.max(0, this._beatFlash - 0.045);
    }

    this._drawScene(W, H, HZ, elapsed);

    // Feedback
    if (this._feedback?.alpha > 0) {
      const f = this._feedback;
      ctx.globalAlpha = f.alpha;
      ctx.fillStyle   = f.color;
      ctx.font = `bold ${Math.round(W * 0.075)}px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.shadowBlur = 12; ctx.shadowColor = f.color;
      ctx.fillText(f.text, W / 2, f.y);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      f.y -= 1.5; f.alpha -= 0.018;
    }

    // Wynik
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(W * 0.065)}px Outfit, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(this._score, 12, 44);

    // Combo
    if (this._combo >= 2) {
      const mul = this._mult();
      ctx.textAlign = 'right';
      ctx.fillStyle = mul >= 3 ? '#f97316' : mul >= 2 ? '#ffd700' : '#22d3ee';
      ctx.font = `bold ${Math.round(W * 0.055)}px Outfit, sans-serif`;
      ctx.fillText(`×${this._combo}`, W - 12, 44);
      if (mul >= 2) {
        ctx.font = `${Math.round(W * 0.035)}px Outfit, sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText(`${mul}× bonus`, W - 12, 66);
      }
    }

    // Pasek postępu
    const prog = clamp(elapsed / LAST_MS, 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(0, H - 5, W, 5);
    ctx.fillStyle = '#a855f7';
    ctx.fillRect(0, H - 5, W * prog, 5);
  }

  drawIdle() {
    const { width: W, height: H } = this.canvas;
    const HZ  = H * 0.78;
    const ctx = this.ctx;
    const LW  = Math.min(W * 0.55, 200);
    const LX  = (W - LW) / 2;

    ctx.fillStyle = '#0a0c10'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fillRect(LX, 0, LW, H);

    // Przykładowe nuty
    [[0.2, 1], [0.42, 0.7], [0.62, 0.5]].forEach(([pos, alpha]) => {
      ctx.globalAlpha = alpha;
      ctx.shadowBlur = 16; ctx.shadowColor = 'rgba(255,255,255,0.4)';
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(W / 2, H * pos, 27, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); ctx.arc(W / 2, H * pos, 12, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    });

    // Strefa
    const grd = ctx.createLinearGradient(LX, 0, LX + LW, 0);
    grd.addColorStop(0, 'rgba(34,197,94,0)'); grd.addColorStop(0.5, 'rgba(34,197,94,0.85)'); grd.addColorStop(1, 'rgba(34,197,94,0)');
    ctx.fillStyle = grd; ctx.fillRect(LX, HZ - 4, LW, 8);
    ctx.shadowBlur = 14; ctx.shadowColor = '#22c55e';
    ctx.strokeStyle = 'rgba(34,197,94,0.55)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(W / 2, HZ, 38, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = `${Math.round(W * 0.038)}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('szybki ruch = uderzenie', W / 2, HZ + 62);
    ctx.fillText(`90 BPM · ${PAT.length} nut`, W / 2, HZ + 85);
  }

  // ── input ─────────────────────────────────────────────────────────────────

  onClick()       { if (this._state === 'playing') this._doHit(); }
  onMouseMove()   {}
  onKey(key)      { if (this._state === 'playing' && (key === ' ' || key === 'Space')) this._doHit(); }
}
