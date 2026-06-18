// games/simon/game.js — Powtórz! (Simon Says)
// Fazy: SHOW (komputer pokazuje sekwencję) → INPUT (gracz powtarza)
// Sterowanie: przechył GX/GZ → wybierz ćwiartkę · click → zatwierdź

import { clamp, drawGrid, radialGlow } from '../../static/gameutils.js';

// 4 panele — indeksy: 0=góralewo(czerwony), 1=góraprawo(niebieski),
//                     2=dółlewo(żółty),      3=dółprawo(zielony)
const PANELS = [
  { label: 'red',    color: '#ef4444', bright: '#ff8888', emoji: '🔴' },
  { label: 'blue',   color: '#3b82f6', bright: '#88bbff', emoji: '🔵' },
  { label: 'yellow', color: '#eab308', bright: '#ffee88', emoji: '🟡' },
  { label: 'green',  color: '#22c55e', bright: '#88ffaa', emoji: '🟢' },
];

// Progi przechyłu [trigger, latch-off]
const TRIG = 15;
const REL  = 5;

// Timing (ms)
const SHOW_ON_BASE  = 600;
const SHOW_OFF      = 200;
const INPUT_TIMEOUT = 3000; // czas na jeden wybór
const FAST_ROUND    = 5;    // od tej rundy przyspieszamy

export default class SimonGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas  = canvas;
    this.ctx     = ctx;
    this.triki   = triki;
    this.emit    = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;

    // Całkowity stan — bezpieczny przed drawIdle()
    this.sequence   = [];   // sekwencja kolorów (indeksy 0-3)
    this.phase      = 'idle'; // 'show' | 'input' | 'result' | 'idle'
    this.showIdx    = 0;    // który element sekwencji teraz pokazujemy
    this.showTimer  = 0;    // odliczanie dla aktualnego kroku pokazywania
    this.showOn     = true; // czy aktualnie "on" (świeci) czy "off" (przerwa)
    this.inputIdx   = 0;    // który element gracz ma teraz wpisać
    this.inputTimer = 0;    // odliczanie timeoutu na odpowiedź
    this.lit        = -1;   // aktualnie podświetlony panel (tilt highlight)
    this.round      = 0;    // numer rundy (= długość sekwencji)
    this.score      = 0;

    this._latchX    = false;
    this._latchZ    = false;
    this._resultTimer = 0;
    this._resultOk    = false;
    this._flashTimer  = 0;  // czerwona ramka błędu
    this._banner      = null;
  }

  start(player) {
    this.player   = player;
    this.sequence = [];
    this.round    = 0;
    this.score    = 0;
    this._latchX  = false;
    this._latchZ  = false;
    this._banner  = null;
    this._flashTimer = 0;
    this.running  = true;
    this._nextRound();
  }

  resize(W, H) { this.W = W; this.H = H; }
  destroy()    { this.running = false; }
  drawIdle()   { this.draw(); }

  // ─── logika rund ─────────────────────────────────────────
  _nextRound() {
    this.round++;
    this.sequence.push(Math.floor(Math.random() * 4));
    this.phase     = 'show';
    this.showIdx   = 0;
    this.showOn    = true;
    const speed    = this._showOnMs();
    this.showTimer = speed;
    this.lit       = this.sequence[0]; // podświetl pierwszy od razu
    this._banner   = null;
    this.emit('stats', `Runda <b>${this.round}</b> · Sekwencja: <b>${this.sequence.length}</b>`);
  }

  _showOnMs() {
    // Przyspiesza od rundy FAST_ROUND
    if (this.round < FAST_ROUND)       return SHOW_ON_BASE;
    if (this.round < FAST_ROUND + 3)   return 400;
    return 300;
  }

  // ─── update ──────────────────────────────────────────────
  update(dt) {
    if (!this.running) return;

    if (this._banner) { this._banner.t -= dt; if (this._banner.t <= 0) this._banner = null; }
    if (this._flashTimer > 0) this._flashTimer -= dt;

    if (this.phase === 'show') {
      this._updateShow(dt);
    } else if (this.phase === 'input') {
      this._updateInput(dt);
    } else if (this.phase === 'result') {
      this._resultTimer -= dt;
      if (this._resultTimer <= 0) {
        if (this._resultOk) {
          this._nextRound();
        } else {
          this.running = false;
          this.emit('end', { score: this.score });
        }
      }
    }
  }

  _updateShow(dt) {
    this.showTimer -= dt;
    if (this.showTimer > 0) return;

    if (this.showOn) {
      // koniec fazy ON → faza OFF (gasimy)
      this.lit     = -1;
      this.showOn  = false;
      this.showTimer = SHOW_OFF;
    } else {
      // koniec fazy OFF → następny element lub przejście do INPUT
      this.showIdx++;
      if (this.showIdx >= this.sequence.length) {
        // sekwencja pokazana — czas na INPUT
        this.phase      = 'input';
        this.inputIdx   = 0;
        this.inputTimer = INPUT_TIMEOUT;
        this.lit        = -1;
        this._latchX    = false;
        this._latchZ    = false;
        this._banner    = { text: 'TWOJA KOLEJ!', t: 900, color: '#a855f7' };
      } else {
        this.lit       = this.sequence[this.showIdx];
        this.showOn    = true;
        this.showTimer = this._showOnMs();
      }
    }
  }

  _updateInput(dt) {
    // --- odczyt przechyłu kapsla (latch na ćwiartkę) ---
    let newLit = -1;
    if (this.triki.connected) {
      const gx = this.triki.GX(0);  // oś pionowa: góra=-,dół=+
      const gz = -this.triki.GZ(0); // oś pozioma: lewo=-,prawo=+

      const up    = gx < -TRIG;
      const down  = gx >  TRIG;
      const right = gz >  TRIG;
      const left  = gz < -TRIG;

      // kombinacja → ćwiartka
      if      (up   && left)  newLit = 0; // góra-lewo  = czerwony
      else if (up   && right) newLit = 1; // góra-prawo = niebieski
      else if (down && left)  newLit = 2; // dół-lewo   = żółty
      else if (down && right) newLit = 3; // dół-prawo  = zielony
    }

    // aktualizuj podświetlenie (płynnie bez latcha)
    this.lit = newLit;

    // --- timeout ---
    this.inputTimer -= dt;
    if (this.inputTimer <= 0) {
      this._wrong();
      return;
    }

    // --- klik = zatwierdź ---
    if (this.triki.consumeClick()) {
      const chosen = this.lit;
      if (chosen < 0) return; // klik bez wyboru = ignoruj

      const expected = this.sequence[this.inputIdx];
      if (chosen === expected) {
        // wibracja (krótka) przez `navigator.vibrate`
        if (navigator.vibrate) navigator.vibrate(30);

        this.inputIdx++;
        this.inputTimer = INPUT_TIMEOUT; // reset timera na następny element

        if (this.inputIdx >= this.sequence.length) {
          // cała sekwencja poprawna!
          this.score++;
          this._banner = { text: '✓ BRAWO!', t: 700, color: '#22c55e' };
          this.emit('stats', `Runda <b>${this.round}</b> · Wynik: <b>${this.score}</b> rund`);
          this.phase        = 'result';
          this._resultOk    = true;
          this._resultTimer = 900;
          this.lit          = -1;
        }
      } else {
        this._wrong();
      }
    }
  }

  _wrong() {
    if (navigator.vibrate) navigator.vibrate(300);
    this._flashTimer  = 700;
    this._banner      = { text: '✗ BŁĄD!', t: 800, color: '#ef4444' };
    this.phase        = 'result';
    this._resultOk    = false;
    this._resultTimer = 1100;
    this.lit          = -1;
  }

  // ─── draw ────────────────────────────────────────────────
  draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);
    drawGrid(ctx, W, H, 0.025);

    const hw = W / 2, hh = H / 2;
    const gap = Math.min(W, H) * 0.025;
    const r   = Math.min(W, H) * 0.06; // zaokrąglenie rogów

    // Czerwona ramka błędu
    if (this._flashTimer > 0) {
      const a = Math.min(1, this._flashTimer / 300) * 0.55;
      ctx.save();
      ctx.strokeStyle = `rgba(239,68,68,${a})`;
      ctx.lineWidth = 18;
      ctx.strokeRect(0, 0, W, H);
      ctx.restore();
    }

    // 4 panele
    const panels = [
      { i: 0, x: 0,   y: 0   },
      { i: 1, x: hw,  y: 0   },
      { i: 2, x: 0,   y: hh  },
      { i: 3, x: hw,  y: hh  },
    ];

    panels.forEach(({ i, x, y }) => {
      const p      = PANELS[i];
      const isLit  = this.lit === i;
      const pw     = hw - gap / 2;
      const ph     = hh - gap / 2;
      const px     = x + (i === 1 || i === 3 ? gap / 2 : 0);
      const py     = y + (i === 2 || i === 3 ? gap / 2 : 0);

      ctx.save();

      // tło panelu
      const col = isLit ? p.bright : p.color;
      ctx.fillStyle = col;
      if (isLit) {
        ctx.shadowColor = col;
        ctx.shadowBlur  = 40;
      }
      ctx.globalAlpha = isLit ? 1.0 : 0.45;
      ctx.beginPath();
      ctx.roundRect(px, py, pw, ph, r);
      ctx.fill();

      // biała ramka przy podświetleniu
      if (isLit) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth   = 4;
        ctx.beginPath();
        ctx.roundRect(px + 2, py + 2, pw - 4, ph - 4, r - 2);
        ctx.stroke();
      }

      // emoji + etykieta
      const cx = px + pw / 2;
      const cy = py + ph / 2;
      const fs = Math.min(pw, ph) * 0.38;
      ctx.globalAlpha = isLit ? 1 : 0.7;
      ctx.shadowBlur  = 0;
      ctx.font        = `${fs}px Outfit,sans-serif`;
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.emoji, cx, cy - fs * 0.1);

      ctx.restore();
    });

    // Separator krzyżowy (cienka linia pośrodku)
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth   = gap;
    ctx.beginPath();
    ctx.moveTo(hw, 0); ctx.lineTo(hw, H);
    ctx.moveTo(0, hh); ctx.lineTo(W, hh);
    ctx.stroke();
    ctx.restore();

    // HUD — pasek stanu (faza, sekwencja, wynik) na górze
    this._drawHUD();

    // Timer progressbar (INPUT)
    if (this.phase === 'input') {
      this._drawTimer();
    }

    // Sekwencja "oczka" na dole (podczas INPUT)
    if (this.phase === 'input' || this.phase === 'show') {
      this._drawDots();
    }

    // Baner
    if (this._banner) {
      const a = Math.min(1, this._banner.t / 250);
      ctx.save();
      ctx.globalAlpha  = a;
      ctx.fillStyle    = this._banner.color || '#ffffff';
      ctx.shadowColor  = this._banner.color || '#ffffff';
      ctx.shadowBlur   = 28;
      ctx.font         = `800 ${Math.round(W / 8)}px Outfit,sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this._banner.text, W / 2, H / 2);
      ctx.restore();
    }
  }

  _drawHUD() {
    const { ctx, W, H } = this;
    const barH = Math.max(28, H * 0.055);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, W, barH);

    ctx.fillStyle    = 'rgba(255,255,255,0.88)';
    ctx.font         = `600 ${Math.round(barH * 0.52)}px Outfit,sans-serif`;
    ctx.textBaseline = 'middle';

    // Lewa: runda
    ctx.textAlign = 'left';
    ctx.fillText(`Runda ${this.round}`, 10, barH / 2);

    // Środek: faza
    let phaseLabel = '';
    if (this.phase === 'show')  phaseLabel = '▶ OGLĄDAJ';
    if (this.phase === 'input') phaseLabel = '✏️ TWOJA KOLEJ';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#a855f7';
    ctx.fillText(phaseLabel, W / 2, barH / 2);

    // Prawo: wynik
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.textAlign = 'right';
    ctx.fillText(`${this.score} rund`, W - 10, barH / 2);

    ctx.restore();
  }

  _drawTimer() {
    const { ctx, W, H } = this;
    const frac = clamp(this.inputTimer / INPUT_TIMEOUT, 0, 1);
    const bh   = 5;
    const by   = Math.max(28, H * 0.055);
    const col  = frac > 0.5 ? '#22c55e' : frac > 0.25 ? '#eab308' : '#ef4444';
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(0, by, W, bh);
    ctx.fillStyle   = col;
    ctx.shadowColor = col;
    ctx.shadowBlur  = 8;
    ctx.fillRect(0, by, W * frac, bh);
    ctx.restore();
  }

  _drawDots() {
    const { ctx, W, H } = this;
    const n    = this.sequence.length;
    const r    = Math.min(8, W / (n * 3 + 2));
    const y    = H - 20;
    const step = r * 2.8;
    const startX = W / 2 - (n - 1) * step / 2;

    ctx.save();
    for (let i = 0; i < n; i++) {
      const p      = PANELS[this.sequence[i]];
      const done   = this.phase === 'input' && i < this.inputIdx;
      const active = this.phase === 'input' && i === this.inputIdx;

      ctx.beginPath();
      ctx.arc(startX + i * step, y, r, 0, Math.PI * 2);
      ctx.fillStyle = done
        ? p.color
        : active
          ? p.bright
          : 'rgba(255,255,255,0.18)';
      if (active) {
        ctx.shadowColor = p.bright;
        ctx.shadowBlur  = 10;
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.fill();
    }
    ctx.restore();
  }
}
