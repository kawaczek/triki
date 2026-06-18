// games/kosci/game.js — Kości (Yahtzee Light)
// Sterowanie:
//   consumeShake() = rzut wszystkich niezatrzymanych kości
//   consumeClick() = zatrzymaj / odblokuj zaznaczoną kość
//   GZ (przechył L/R) = przesuń kursor wyboru kości (latch)

import { clamp, drawGrid } from '../../static/gameutils.js';

const NUM_DICE   = 5;
const MAX_ROLLS  = 3;
const MAX_TURNS  = 6;
const ROLL_MS    = 600;   // czas animacji rzutu
const TRIG_LATCH = 12;    // próg przechyłu do zmiany zaznaczenia
const REL_LATCH  = 4;

// Oczkowe wzory dla kości 1-6 [lista pozycji {fx, fy} gdzie 0..1]
const DOT_PATTERNS = [
  [],                                                             // 0 — nieużywane
  [{fx:0.5,  fy:0.5}],                                          // 1
  [{fx:0.25, fy:0.25}, {fx:0.75, fy:0.75}],                    // 2
  [{fx:0.25, fy:0.25}, {fx:0.5,  fy:0.5},  {fx:0.75, fy:0.75}], // 3
  [{fx:0.25, fy:0.25}, {fx:0.75, fy:0.25}, {fx:0.25, fy:0.75}, {fx:0.75, fy:0.75}], // 4
  [{fx:0.25, fy:0.25}, {fx:0.75, fy:0.25}, {fx:0.5,  fy:0.5},  {fx:0.25, fy:0.75}, {fx:0.75, fy:0.75}], // 5
  [{fx:0.25, fy:0.2},  {fx:0.75, fy:0.2},  {fx:0.25, fy:0.5},  {fx:0.75, fy:0.5},  {fx:0.25, fy:0.8},  {fx:0.75, fy:0.8}], // 6
];

function rollDie() { return Math.floor(Math.random() * 6) + 1; }

// Oblicz najlepszy wynik z tablicy 5 wartości (kości)
function bestScore(values) {
  const counts = Array(7).fill(0);
  values.forEach(v => counts[v]++);
  const sorted = [...values].sort((a, b) => b - a);
  const maxCount = Math.max(...counts);

  // Yahtzee
  if (maxCount === 5) return {combo: 'Yahtzee!', pts: 50};

  // Duża sekwencja (1-5 lub 2-6)
  const uniq = [...new Set(sorted)].sort((a,b) => a - b);
  if (uniq.length >= 5) {
    const str = uniq.join('');
    if (str.includes('12345') || str.includes('23456')) return {combo: 'Duża sekwencja', pts: 40};
  }

  // Mała sekwencja (4 kolejne)
  const uStr = uniq.join('');
  if (['1234','2345','3456'].some(s => uStr.includes(s))) return {combo: 'Mała sekwencja', pts: 30};

  // Full house (3+2)
  const fours = counts.filter(c => c === 4);
  const threes = counts.filter(c => c === 3);
  const pairs  = counts.filter(c => c === 2);
  if (threes.length && pairs.length) return {combo: 'Full House', pts: 25};

  // Cztery jednakowe
  if (maxCount >= 4) {
    const v = counts.findIndex(c => c >= 4);
    return {combo: 'Cztery jednakowe', pts: v * 4};
  }

  // Trójka
  if (maxCount >= 3) {
    const v = counts.findIndex(c => c >= 3);
    return {combo: 'Trójka', pts: v * 3};
  }

  // Para × 2
  const pairVals = counts.reduce((acc, c, v) => { if (c >= 2) acc.push(v); return acc; }, []);
  if (pairVals.length >= 2) {
    // Dwie pary
    const top2 = pairVals.slice(-2);
    return {combo: 'Dwie pary', pts: (top2[0] + top2[1]) * 2};
  }
  if (pairVals.length === 1) {
    return {combo: 'Para', pts: pairVals[0] * 2};
  }

  return {combo: 'Brak układu', pts: 0};
}

export default class KosciGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas  = canvas;
    this.ctx     = ctx;
    this.triki   = triki;
    this.emit    = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;

    // Inicjalizacja całego stanu — drawIdle() może być wywołane przed start()
    this._initState();
  }

  _initState() {
    this.dice        = Array.from({length: NUM_DICE}, () => ({
      value:   1,
      held:    false,
      rolling: false,
      _rollingVal: 1,
    }));
    this.selected    = 0;        // indeks zaznaczonej kości
    this.rollsLeft   = MAX_ROLLS;
    this.turnsLeft   = MAX_TURNS;
    this.totalScore  = 0;
    this.lastCombo   = null;     // {combo, pts} z poprzedniej tury
    this._rollTimer  = 0;        // ms trwania animacji
    this._rolling    = false;
    this._turnResult = null;     // wynik bieżącej tury do pokazania
    this._showResult = 0;        // timer pokazania wyniku [ms]
    this._tiltLatch      = false;
    this._banner         = null;
    this._scoreAfterRoll = false;
  }

  start(player) {
    this.player = player;
    this._initState();
    this.running   = true;
    this._rollAll();             // automatyczny pierwszy rzut
    this._emitStats();
  }

  resize(W, H) { this.W = W; this.H = H; }
  destroy()    { this.running = false; }
  drawIdle()   { this.draw(); }

  // ─── update ──────────────────────────────────────────────
  update(dt) {
    if (!this.running) return;

    // Animacja rzutu
    if (this._rolling) {
      this._rollTimer -= dt;
      // Losuj wartości animacyjne dla kości które się toczą
      this.dice.forEach(d => {
        if (d.rolling) d._rollingVal = rollDie();
      });
      if (this._rollTimer <= 0) {
        this._rolling = false;
        this.dice.forEach(d => { d.rolling = false; });
        if (this._scoreAfterRoll) {
          this._scoreAfterRoll = false;
          this._doScore();
        } else {
          this._emitStats();
        }
      }
      return;
    }

    // Wyświetl wynik tury
    if (this._showResult > 0) {
      this._showResult -= dt;
      if (this._showResult <= 0) {
        this._turnResult = null;
        // Sprawdź koniec gry
        if (this.turnsLeft <= 0) {
          this.running = false;
          this.emit('end', {score: this.totalScore});
          return;
        }
        // Nowa tura — odblokuj wszystkie kości i resetuj rzuty
        this.dice.forEach(d => d.held = false);
        this.rollsLeft = MAX_ROLLS;
        this._rollAll();
        this._emitStats();
      }
      return;
    }

    // Kursor — przechył boczny
    const hz = -this.triki.GZ(0);
    if (Math.abs(hz) >= TRIG_LATCH) {
      if (!this._tiltLatch) {
        this._tiltLatch = true;
        this.selected = clamp(this.selected + (hz > 0 ? 1 : -1), 0, NUM_DICE - 1);
      }
    } else if (Math.abs(hz) < REL_LATCH) {
      this._tiltLatch = false;
    }

    // Click = toggle held zaznaczonej kości
    if (this.triki.consumeClick()) {
      const d = this.dice[this.selected];
      d.held = !d.held;
    }

    // Shake = rzut
    if (this.triki.consumeShake()) {
      if (this.rollsLeft > 0) {
        this.rollsLeft--;
        this._rollFree();
        if (this.rollsLeft === 0) {
          // Ostatni rzut — za chwilę oceniamy
          this._scheduleScore();
        }
      }
    }

    if (this._banner) {
      this._banner.t -= dt;
      if (this._banner.t <= 0) this._banner = null;
    }
  }

  // ─── mechanika ───────────────────────────────────────────
  _rollAll() {
    this.dice.forEach(d => {
      d.value   = rollDie();
      d._rollingVal = d.value;
      d.rolling = true;
      d.held    = false;
    });
    this._rolling    = true;
    this._rollTimer  = ROLL_MS;
  }

  _rollFree() {
    this.dice.forEach(d => {
      if (!d.held) {
        d.value   = rollDie();
        d._rollingVal = d.value;
        d.rolling = true;
      }
    });
    this._rolling   = true;
    this._rollTimer = ROLL_MS;
  }

  _scheduleScore() {
    // Wynik zostanie obliczony po zakończeniu animacji — ustawiamy flagę
    this._scoreAfterRoll = true;
  }

  // Wywołane po zakończeniu animacji gdy rollsLeft === 0
  _doScore() {
    const values = this.dice.map(d => d.value);
    const {combo, pts} = bestScore(values);
    this.totalScore  += pts;
    this.lastCombo    = {combo, pts};
    this._turnResult  = {combo, pts};
    this.turnsLeft--;
    this._showResult  = 2200;  // ms wyświetlania wyniku tury
    this._banner      = {text: `+${pts} pkt`, t: 1600, sub: combo};
    this._emitStats();
  }

  // ─── draw ────────────────────────────────────────────────
  draw() {
    const {ctx, W, H} = this;
    ctx.clearRect(0, 0, W, H);
    drawGrid(ctx, W, H, 0.025);

    // Layout: 5 kości w rzędzie (lub 3+2 na wąskim ekranie)
    const diceSize  = clamp(Math.min(W / 5.8, H / 6), 46, 90);
    const gap       = Math.max(8, diceSize * 0.14);
    const totalW    = NUM_DICE * diceSize + (NUM_DICE - 1) * gap;
    const startX    = (W - totalW) / 2;
    const diceY     = H * 0.38 - diceSize / 2;

    // Rysuj kości
    this.dice.forEach((d, i) => {
      const x = startX + i * (diceSize + gap);
      const y = diceY;
      const val = d.rolling ? d._rollingVal : d.value;
      this._drawDie(ctx, x, y, diceSize, val, d.held, i === this.selected, d.rolling);
    });

    // Wskaźniki stanu
    this._drawStatusBar(ctx, W, H, diceSize, diceY);

    // Wynik ostatniej tury (overlay)
    if (this._turnResult) {
      this._drawResultOverlay(ctx, W, H);
    }

    // Banner (+punkty)
    if (this._banner) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this._banner.t / 400);
      ctx.fillStyle   = '#a855f7';
      ctx.font        = `800 ${Math.round(W / 9)}px Outfit, sans-serif`;
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = '#a855f7';
      ctx.shadowBlur  = 28;
      ctx.fillText(this._banner.text, W / 2, H * 0.18);
      if (this._banner.sub) {
        ctx.shadowBlur = 0;
        ctx.font       = `600 ${Math.round(W / 16)}px Outfit, sans-serif`;
        ctx.fillStyle  = 'rgba(255,255,255,0.85)';
        ctx.fillText(this._banner.sub, W / 2, H * 0.18 + Math.round(W / 8));
      }
      ctx.restore();
    }
  }

  _drawDie(ctx, x, y, size, value, held, selected, rolling = false) {
    const r = size * 0.15;  // promień narożników

    ctx.save();

    // Podświetlenie zaznaczonej kości
    if (selected) {
      ctx.shadowColor = '#c084fc';
      ctx.shadowBlur  = 18;
    }

    // Ramka: złota = held, fioletowa = selected, biała = zwykła
    if (held) {
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth   = Math.max(3, size * 0.07);
    } else if (selected) {
      ctx.strokeStyle = '#c084fc';
      ctx.lineWidth   = Math.max(2, size * 0.055);
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth   = Math.max(1.5, size * 0.04);
    }

    // Tło kości — lekko jaśniejsze gdy się toczy (pulsuje)
    ctx.fillStyle = rolling
      ? 'rgba(255,255,255,0.75)'
      : (held ? 'rgba(251,191,36,0.18)' : 'rgba(255,255,255,0.92)');
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, r);
    ctx.fill();
    ctx.stroke();

    ctx.restore();

    // Kropki (oczka)
    const dotR = size * 0.085;
    const pats = DOT_PATTERNS[value] || [];
    ctx.save();
    ctx.fillStyle = '#1e1b4b';
    pats.forEach(({fx, fy}) => {
      ctx.beginPath();
      ctx.arc(x + fx * size, y + fy * size, dotR, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();

    // Ikona "HOLD" na zatrzymanej kości
    if (held) {
      ctx.save();
      ctx.fillStyle   = '#fbbf24';
      ctx.font        = `700 ${Math.round(size * 0.2)}px Outfit, sans-serif`;
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'bottom';
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur  = 6;
      ctx.fillText('HOLD', x + size / 2, y + size + size * 0.28);
      ctx.restore();
    }
  }

  _drawStatusBar(ctx, W, H, diceSize, diceY) {
    const barY = diceY + diceSize + diceSize * 0.55;

    ctx.save();
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';

    // Rzuty i tury
    const infoSize = clamp(W / 22, 11, 17);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = `600 ${infoSize}px Outfit, sans-serif`;
    ctx.fillText(`Rzuty: ${this.rollsLeft} / ${MAX_ROLLS}`, W / 4, barY);
    ctx.fillText(`Tury: ${this.turnsLeft} / ${MAX_TURNS}`, W * 3 / 4, barY);

    // Wynik totalny
    ctx.fillStyle   = '#ffffff';
    ctx.font        = `800 ${clamp(W / 12, 18, 32)}px Outfit, sans-serif`;
    ctx.shadowColor = '#a855f7';
    ctx.shadowBlur  = 14;
    ctx.fillText(`${this.totalScore} pkt`, W / 2, barY + infoSize * 1.8);
    ctx.restore();

    // Podpowiedź: potrząśnij lub wynik ostatniego układu
    const hintY = barY + infoSize * 3.8;
    ctx.save();
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';

    if (this._rolling) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = `italic ${clamp(W / 20, 11, 15)}px Outfit, sans-serif`;
      ctx.fillText('rzucam…', W / 2, hintY);
    } else if (this.rollsLeft > 0 && !this._turnResult) {
      ctx.fillStyle = 'rgba(255,255,255,0.38)';
      ctx.font = `${clamp(W / 20, 11, 15)}px Outfit, sans-serif`;
      ctx.fillText('Potrząśnij żeby rzucić 🎲', W / 2, hintY);
    } else if (this.lastCombo && !this._turnResult) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = `600 ${clamp(W / 20, 11, 15)}px Outfit, sans-serif`;
      ctx.fillText(`Ostatnio: ${this.lastCombo.combo} (${this.lastCombo.pts} pkt)`, W / 2, hintY);
    }
    ctx.restore();

    // Instrukcja (dolny pasek)
    const instrY = H - 28;
    ctx.save();
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle   = 'rgba(255,255,255,0.28)';
    ctx.font        = `${clamp(W / 26, 9, 13)}px Outfit, sans-serif`;
    ctx.fillText('Przechył L/R = wybierz · Guzik = zatrzymaj/puść', W / 2, instrY);
    ctx.restore();
  }

  _drawResultOverlay(ctx, W, H) {
    if (!this._turnResult) return;
    const {combo, pts} = this._turnResult;

    // Półprzezroczyste tło
    ctx.save();
    ctx.fillStyle = 'rgba(10,8,30,0.72)';
    ctx.fillRect(0, 0, W, H);

    // Karta wyników
    const cardW = Math.min(W * 0.8, 320);
    const cardH = 140;
    const cx    = (W - cardW) / 2;
    const cy    = (H - cardH) / 2;

    ctx.fillStyle   = 'rgba(30,20,60,0.95)';
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth   = 2;
    ctx.shadowColor = '#a855f7';
    ctx.shadowBlur  = 24;
    ctx.beginPath();
    ctx.roundRect(cx, cy, cardW, cardH, 18);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle   = '#ffffff';
    ctx.font        = `800 ${clamp(W / 10, 18, 28)}px Outfit, sans-serif`;
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(combo, W / 2, cy + cardH * 0.36);

    ctx.fillStyle   = '#a855f7';
    ctx.font        = `700 ${clamp(W / 8, 22, 36)}px Outfit, sans-serif`;
    ctx.shadowColor = '#a855f7';
    ctx.shadowBlur  = 16;
    ctx.fillText(`+${pts} pkt`, W / 2, cy + cardH * 0.7);
    ctx.restore();
  }

  _emitStats() {
    // Oblicz bieżący możliwy wynik
    const values = this.dice.map(d => d.value);
    const {combo, pts} = bestScore(values);
    this.emit('stats',
      `🎲 Tura <b>${MAX_TURNS - this.turnsLeft + 1}/${MAX_TURNS}</b>`
      + ` &nbsp;·&nbsp; Rzuty: <b>${this.rollsLeft}</b>`
      + ` &nbsp;·&nbsp; Suma: <b>${this.totalScore}</b> pkt`
      + (this._rolling ? '' : ` &nbsp;·&nbsp; ${combo}: <b>${pts}</b>`)
    );
  }
}
