// games/refleks/game.js — Test Refleksu
// 10 prób: czekaj na zielony sygnał, kliknij jak najszybciej!
// Falstart (kliknięcie podczas czekania) = +200ms kary.
// Wynik końcowy = średni czas reakcji w ms. Niższy = lepszy.

import { clamp, drawGrid, radialGlow } from '../../static/gameutils.js';

const TOTAL_TRIALS   = 10;
const WAIT_MIN_MS    = 1500;
const WAIT_MAX_MS    = 4500;
const RESULT_SHOW_MS = 1000;
const FALSE_START_PENALTY = 200;  // ms kary

// Fazy jednej próby
const PHASE_WAIT    = 'wait';
const PHASE_GO      = 'go';
const PHASE_RESULT  = 'result';

export default class RefleksGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas  = canvas;
    this.ctx     = ctx;
    this.triki   = triki;
    this.emit    = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;

    // wyniki prób
    this.results     = [];   // {ms, falseStart} per trial
    this.trial       = 0;    // aktualny numer próby (0-based)
    this.phase       = PHASE_WAIT;
    this._phaseTimer = 0;    // ms do końca fazy WAIT lub RESULT
    this._goTimer    = 0;    // ms od początku fazy GO
    this._lastResult = null; // {ms, falseStart} ostatniej próby (do wyświetlania)
    this._mx         = 0.5;
    this._myClick    = false;
    this._pulsePhi   = 0;    // faza pulsu okręgu
  }

  start(player) {
    this.player      = player;
    this.results     = [];
    this.trial       = 0;
    this.phase       = PHASE_WAIT;
    this._phaseTimer = this._randomWait();
    this._goTimer    = 0;
    this._lastResult = null;
    this._pulsePhi   = 0;
    this.running     = true;
    this._emitStats();
  }

  resize(W, H) { this.W = W; this.H = H; }

  onMouseMove(nx, ny) { this._mx = nx; }

  onClick(nx, ny) {
    this._myClick = true;
  }

  onKeyDown(code) {
    if (code === 'Space' || code === 'Enter') this._myClick = true;
  }

  update(dt) {
    if (!this.running) return;
    this._pulsePhi += dt * 0.003;

    // kliknięcie — BLE lub mysz/klawiatura
    const clicked = this.triki.consumeClick() || this._myClick;
    this._myClick = false;

    if (this.phase === PHASE_WAIT) {
      this._phaseTimer -= dt;

      if (clicked) {
        // falstart!
        this.results.push({ ms: FALSE_START_PENALTY, falseStart: true });
        this._lastResult = { ms: FALSE_START_PENALTY, falseStart: true };
        this.trial++;
        if (this.trial >= TOTAL_TRIALS) {
          this._finish();
        } else {
          this.phase       = PHASE_RESULT;
          this._phaseTimer = RESULT_SHOW_MS;
        }
        this._emitStats();
        return;
      }

      if (this._phaseTimer <= 0) {
        // czas minął — pokaż zielony
        this.phase    = PHASE_GO;
        this._goTimer = 0;
      }

    } else if (this.phase === PHASE_GO) {
      this._goTimer += dt;

      if (clicked) {
        const reactionMs = Math.round(this._goTimer);
        this.results.push({ ms: reactionMs, falseStart: false });
        this._lastResult = { ms: reactionMs, falseStart: false };
        this.trial++;
        if (this.trial >= TOTAL_TRIALS) {
          this._finish();
        } else {
          this.phase       = PHASE_RESULT;
          this._phaseTimer = RESULT_SHOW_MS;
        }
        this._emitStats();
      }

    } else if (this.phase === PHASE_RESULT) {
      this._phaseTimer -= dt;
      if (this._phaseTimer <= 0) {
        // następna próba
        this.phase       = PHASE_WAIT;
        this._phaseTimer = this._randomWait();
        this._goTimer    = 0;
      }
    }
  }

  draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    if (this.phase === PHASE_WAIT) {
      this._drawWait();
    } else if (this.phase === PHASE_GO) {
      this._drawGo();
    } else if (this.phase === PHASE_RESULT) {
      this._drawResult();
    }

    // pasek postępu na dole (próby jako kropki)
    this._drawProgress();
  }

  drawIdle() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    // ciemne tło z gradientem
    const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    bg.addColorStop(0, '#1e1b4b');
    bg.addColorStop(1, '#0a0a16');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    drawGrid(ctx, W, H, 0.025);

    // pulsujące pytajniki
    const phi = (Date.now() / 700) % (Math.PI * 2);
    const cr  = W * 0.22 + Math.sin(phi) * W * 0.03;
    radialGlow(ctx, W / 2, H * 0.45, cr, '#7c3aed', 0.3);

    ctx.save();
    ctx.font = `bold ${Math.round(W / 3.5)}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.7 + Math.sin(phi) * 0.3;
    ctx.fillStyle = '#c4b5fd';
    ctx.fillText('⚡', W / 2, H * 0.42);
    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `${Math.round(W / 16)}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('10 prób · kliknij gdy zielony', W / 2, H * 0.68);

    this._drawProgress();
  }

  destroy() { this.running = false; }

  // ── rysowanie faz ─────────────────────────────────────────────

  _drawWait() {
    const { ctx, W, H } = this;

    // ciemne czerwonawe tło
    const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    bg.addColorStop(0, '#2d0a0a');
    bg.addColorStop(1, '#0a0505');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    drawGrid(ctx, W, H, 0.02);

    // pulsujący okrąg
    const pulse = Math.sin(this._pulsePhi) * 0.12 + 0.88;
    const cr = W * 0.28 * pulse;
    radialGlow(ctx, W / 2, H * 0.42, cr * 1.5, '#991b1b', 0.35);
    ctx.beginPath();
    ctx.arc(W / 2, H * 0.42, cr, 0, Math.PI * 2);
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 3;
    ctx.stroke();

    // napis CZEKAJ
    ctx.save();
    ctx.font = `bold ${Math.round(W / 8)}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fca5a5';
    ctx.fillText('CZEKAJ...', W / 2, H * 0.42);
    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = `${Math.round(W / 18)}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Nie klikaj jeszcze!', W / 2, H * 0.58);
  }

  _drawGo() {
    const { ctx, W, H } = this;

    // jasne zielone tło
    const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    bg.addColorStop(0, '#052e16');
    bg.addColorStop(1, '#010a04');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    drawGrid(ctx, W, H, 0.025);

    // wielka zielona poświata
    radialGlow(ctx, W / 2, H * 0.38, W * 0.42, '#22c55e', 0.5);

    // duży napis KLIKNIJ!
    ctx.save();
    ctx.shadowColor = '#4ade80';
    ctx.shadowBlur  = 30;
    ctx.font = `bold ${Math.round(W / 6.5)}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#86efac';
    ctx.fillText('KLIKNIJ!', W / 2, H * 0.38);
    ctx.restore();

    // rosnący licznik ms
    const msDisplay = Math.round(this._goTimer);
    ctx.save();
    ctx.font = `bold ${Math.round(W / 9)}px 'Outfit', monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#4ade80';
    ctx.fillText(msDisplay + ' ms', W / 2, H * 0.54);
    ctx.restore();
  }

  _drawResult() {
    const { ctx, W, H } = this;
    const r = this._lastResult;

    // tło
    const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    bg.addColorStop(0, r?.falseStart ? '#2d1200' : '#0f172a');
    bg.addColorStop(1, '#030712');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    drawGrid(ctx, W, H, 0.02);

    if (!r) return;

    if (r.falseStart) {
      radialGlow(ctx, W / 2, H * 0.4, W * 0.3, '#f97316', 0.4);
      ctx.fillStyle = '#fed7aa';
      ctx.font = `bold ${Math.round(W / 8)}px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Falstart! 🚫', W / 2, H * 0.38);
      ctx.fillStyle = '#fdba74';
      ctx.font = `${Math.round(W / 13)}px Outfit, sans-serif`;
      ctx.fillText(`+${FALSE_START_PENALTY}ms kara`, W / 2, H * 0.52);
    } else {
      radialGlow(ctx, W / 2, H * 0.4, W * 0.3, '#22c55e', 0.4);
      const comment = this._rateMs(r.ms);
      ctx.fillStyle = '#bbf7d0';
      ctx.font = `bold ${Math.round(W / 6.5)}px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(r.ms + ' ms', W / 2, H * 0.36);
      ctx.fillStyle = '#86efac';
      ctx.font = `${Math.round(W / 13)}px Outfit, sans-serif`;
      ctx.fillText(comment, W / 2, H * 0.52);
    }
  }

  _drawProgress() {
    const { ctx, W, H } = this;
    const n = TOTAL_TRIALS;
    const dotR = clamp(W / 36, 7, 14);
    const spacing = dotR * 3;
    const totalW = (n - 1) * spacing;
    const startX = W / 2 - totalW / 2;
    const y = H - dotR * 2.5;

    for (let i = 0; i < n; i++) {
      const x = startX + i * spacing;
      const res = this.results[i];
      let color;
      if (!res) {
        // niewykonana
        color = i === this.trial && this.running ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.18)';
      } else if (res.falseStart) {
        color = '#f97316';
      } else {
        // kolor zależy od czasu
        color = res.ms < 250 ? '#4ade80' : res.ms < 350 ? '#a3e635' : res.ms < 450 ? '#facc15' : '#f87171';
      }

      ctx.beginPath();
      ctx.arc(x, y, dotR, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // wynik w kropce (jeśli zmieszczone)
      if (res && !res.falseStart && dotR >= 10) {
        ctx.save();
        ctx.font = `bold ${Math.round(dotR * 0.85)}px Outfit, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#000';
        ctx.fillText(res.ms > 999 ? '∞' : res.ms, x, y);
        ctx.restore();
      } else if (res?.falseStart && dotR >= 10) {
        ctx.save();
        ctx.font = `bold ${Math.round(dotR * 0.9)}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.fillText('!', x, y);
        ctx.restore();
      }
    }
  }

  // ── pomocnicze ────────────────────────────────────────────────

  _randomWait() {
    return WAIT_MIN_MS + Math.random() * (WAIT_MAX_MS - WAIT_MIN_MS);
  }

  _rateMs(ms) {
    if (ms < 200) return 'Ninja ⚡';
    if (ms < 300) return 'Szybki 🐆';
    if (ms < 400) return 'Dobry 👍';
    return 'Ćwicz więcej 🐢';
  }

  _finish() {
    this.running = false;
    const valid  = this.results.filter(r => !r.falseStart);
    const avg    = valid.length > 0
      ? Math.round(valid.reduce((s, r) => s + r.ms, 0) / valid.length)
      : 999;
    const falseCount = this.results.filter(r => r.falseStart).length;
    const rating = this._rateMs(avg);

    // ostatni rysunek — ekran końcowy
    this._drawFinal(avg, rating, falseCount);
    this.emit('end', { score: avg });
  }

  _drawFinal(avg, rating, falseCount) {
    // Wywoływane raz po zakończeniu — aplikacja i tak przełączy do ekranu końcowego
    // ale dobry stan rysowania jest przyjemny
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    bg.addColorStop(0, '#0d0026');
    bg.addColorStop(1, '#03000a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    drawGrid(ctx, W, H, 0.025);

    radialGlow(ctx, W / 2, H * 0.38, W * 0.36, '#7c3aed', 0.45);

    ctx.fillStyle = '#e9d5ff';
    ctx.font = `bold ${Math.round(W / 5.5)}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(avg + ' ms', W / 2, H * 0.36);

    ctx.fillStyle = '#c4b5fd';
    ctx.font = `${Math.round(W / 11)}px Outfit, sans-serif`;
    ctx.fillText(rating, W / 2, H * 0.52);

    if (falseCount > 0) {
      ctx.fillStyle = 'rgba(251,146,60,0.8)';
      ctx.font = `${Math.round(W / 18)}px Outfit, sans-serif`;
      ctx.fillText(`Falstarty: ${falseCount}`, W / 2, H * 0.62);
    }

    this._drawProgress();
  }

  _emitStats() {
    const done = this.results.length;
    const valid = this.results.filter(r => !r.falseStart);
    const avg = valid.length > 0
      ? Math.round(valid.reduce((s, r) => s + r.ms, 0) / valid.length)
      : '—';
    this.emit('stats', `Próba <b>${Math.min(done + 1, TOTAL_TRIALS)}/${TOTAL_TRIALS}</b> &nbsp;·&nbsp; średnia <b>${avg} ms</b>`);
  }
}
