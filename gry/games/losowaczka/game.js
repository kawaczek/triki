import { clamp } from '../../static/gameutils.js';

const SHAKE_G       = 1.30;
const DEBOUNCE_COIN = 220;  // ms — moneta reaguje szybko na każde potrząśnięcie
const DEBOUNCE_REST = 650;  // ms — kość i 8-ball wolniej

const MODES = ['dice', 'coin', 'ball'];
const MODE_LABELS = { dice: '🎲 Kość', coin: '🪙 Moneta', ball: '🎱 Magic 8' };

const DICE_FACES  = ['⚀','⚁','⚂','⚃','⚄','⚅'];
const COIN_FACES  = ['ORZEŁ', 'RESZKA'];
const COIN_EMOJI  = ['🦅', '🏛️'];
const BALL_ANSWERS = [
  'TAK!','ABSOLUTNIE','ZDECYDOWANIE','NA PEWNO','RACZEJ TAK',
  'MOŻE','TRUDNO POWIEDZIEĆ','ZAPYTAJ JUTRO','NIE TERAZ',
  'RACZEJ NIE','NIE','ABSOLUTNIE NIE','NIGDY W ŻYCIU',
];

const ROLL_MS     = 400;
const COIN_MAX_HIST = 10;   // ile ostatnich rzutów pokazujemy

export default class LosowaczkaGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas  = canvas;
    this.ctx     = ctx;
    this.triki   = triki;
    this.emit    = emit;

    this._mode    = 0;
    this._result  = null;
    this._rolling = false;
    this._rollT   = 0;
    this._prevG   = 0;
    this._lastT   = -9999;
    this._t       = 0;
    this._running = false;
    this._hint    = 1;

    // historia rzutów monetą
    this._coinHist  = [];   // tablica 0/1 (0=orzeł, 1=reszka)
    this._coinCount = [0, 0]; // [orzeł, reszka]
  }

  start()  { this._running = true; this._result = null; this._hint = 1; }
  stop()   { this._running = false; }
  resize() {}

  _debounce() {
    return MODES[this._mode] === 'coin' ? DEBOUNCE_COIN : DEBOUNCE_REST;
  }

  _roll() {
    if (this._rolling) return;
    this._rolling = true;
    this._rollT   = 0;
    this._hint    = 0;
    const m = MODES[this._mode];
    if (m === 'dice') {
      this._result = { type: 'dice', val: Math.floor(Math.random() * 6) };
    } else if (m === 'coin') {
      const v = Math.floor(Math.random() * 2);
      this._result = { type: 'coin', val: v };
      // dopisz do historii
      this._coinHist.push(v);
      if (this._coinHist.length > COIN_MAX_HIST) this._coinHist.shift();
      this._coinCount[v]++;
    } else {
      this._result = { type: 'ball', val: Math.floor(Math.random() * BALL_ANSWERS.length) };
    }
  }

  update(dt) {
    this._t += dt;
    if (!this._running) return;

    if (this._rolling) {
      this._rollT += dt;
      if (this._rollT >= ROLL_MS) this._rolling = false;
    }

    const deb = this._debounce();
    const g   = Math.hypot(this.triki.ax, this.triki.ay, this.triki.az);
    if (g >= SHAKE_G && this._prevG < SHAKE_G && this._t - this._lastT > deb) {
      this._lastT = this._t;
      this._roll();
    }
    this._prevG = g;

    if (this.triki.consumeClick?.() && this._t - this._lastT > deb) {
      this._lastT = this._t;
      this._roll();
    }
  }

  draw() {
    const { width: W, height: H } = this.canvas;
    const ctx = this.ctx;
    const CX = W / 2, CY = H / 2;

    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, W, H);

    // Zakładki trybów
    const tabW = W / MODES.length;
    MODES.forEach((m, i) => {
      const active = i === this._mode;
      ctx.fillStyle = active ? 'rgba(59,130,246,0.22)' : 'rgba(255,255,255,0.04)';
      ctx.beginPath(); ctx.roundRect(i * tabW + 4, 8, tabW - 8, 38, 8); ctx.fill();
      ctx.fillStyle = active ? '#3b82f6' : 'rgba(255,255,255,0.35)';
      ctx.font = `${active ? 'bold ' : ''}${Math.round(W * 0.042)}px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(MODE_LABELS[m], i * tabW + tabW / 2, 32);
    });

    if (MODES[this._mode] === 'coin') {
      this._drawCoin(ctx, W, H, CX, CY);
    } else {
      this._drawOther(ctx, W, H, CX, CY);
    }

    // Podpowiedź
    if (this._hint > 0 && MODES[this._mode] !== 'coin') {
      ctx.globalAlpha = this._hint * 0.45;
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.round(W * 0.038)}px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('potrząśnij lub kliknij', CX, H - 28);
      ctx.globalAlpha = 1;
    }
  }

  _drawCoin(ctx, W, H, CX, CY) {
    const prog  = this._rolling ? this._rollT / ROLL_MS : 1;
    const shake = this._rolling ? Math.sin(this._t * 0.08) * (1 - prog) * 16 : 0;

    // Główna moneta — wynik lub animacja
    ctx.save();
    ctx.translate(CX + shake, 0);

    if (!this._result || this._rolling) {
      // Animacja lub idle
      const emoji = this._rolling
        ? (Math.random() < 0.5 ? '🦅' : '🏛️')  // miga podczas lotu
        : '🪙';
      ctx.font = `${Math.round(W * 0.22)}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const bob = this._rolling ? 0 : Math.sin(this._t * 0.0015) * 8;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(emoji, 0, CY - 30 + bob);
      ctx.textBaseline = 'alphabetic';
    } else {
      // Wynik
      const orzel = this._result.val === 0;
      ctx.font = `${Math.round(W * 0.2)}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(orzel ? '🦅' : '🏛️', 0, CY - 40);
      ctx.textBaseline = 'alphabetic';
      ctx.font = `bold ${Math.round(W * 0.085)}px Outfit, sans-serif`;
      ctx.fillStyle = '#ffd700';
      ctx.shadowBlur = 18; ctx.shadowColor = '#ffd700';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(COIN_FACES[this._result.val], 0, CY + 30);
      ctx.shadowBlur = 0;
    }
    ctx.restore();

    // Historia rzutów
    if (this._coinHist.length > 0) {
      const histY  = CY + 70;
      const dotR   = Math.round(W * 0.028);
      const gap    = dotR * 2.5;
      const total  = this._coinHist.length;
      const startX = CX - (total - 1) * gap / 2;
      this._coinHist.forEach((v, i) => {
        const x   = startX + i * gap;
        const isNew = i === total - 1 && this._rolling === false;
        ctx.beginPath();
        ctx.arc(x, histY, dotR, 0, Math.PI * 2);
        ctx.fillStyle = v === 0 ? '#f59e0b' : '#94a3b8';
        ctx.shadowBlur = isNew ? 12 : 0;
        ctx.shadowColor = v === 0 ? '#f59e0b' : '#94a3b8';
        ctx.fill();
        ctx.shadowBlur = 0;
        // litera O/R
        ctx.fillStyle = '#000';
        ctx.font = `bold ${Math.round(dotR * 1.1)}px Outfit, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(v === 0 ? 'O' : 'R', x, histY);
      });
      ctx.textBaseline = 'alphabetic';

      // Licznik
      const histLabelY = histY + dotR + 20;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = `${Math.round(W * 0.036)}px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(
        `🦅 Orzeł: ${this._coinCount[0]}   🏛️ Reszka: ${this._coinCount[1]}`,
        CX, histLabelY
      );
    }

    // Podpowiedź potrząśnięcia (jeśli brak historii)
    if (this._coinHist.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.font = `${Math.round(W * 0.038)}px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('potrząśnij kapslem żeby rzucić monetą', CX, H - 28);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.font = `${Math.round(W * 0.032)}px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('kolejne potrząśnięcia = kolejne rzuty', CX, H - 28);
    }
  }

  _drawOther(ctx, W, H, CX, CY) {
    const prog  = this._rolling ? this._rollT / ROLL_MS : 1;
    const shake = this._rolling ? Math.sin(this._t * 0.05) * (1 - prog) * 18 : 0;

    if (this._result && !this._rolling) {
      this._drawResult(ctx, W, H, CX, CY);
    } else if (this._rolling) {
      ctx.save(); ctx.translate(shake, 0);
      const m = MODES[this._mode];
      if (m === 'dice') {
        const rnd = Math.floor(Math.random() * 6);
        ctx.font = `${Math.round(W * 0.22)}px serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillText(DICE_FACES[rnd], CX, CY);
      } else {
        ctx.font = `${Math.round(W * 0.22)}px serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText('🎱', CX, CY);
      }
      ctx.restore();
      ctx.textBaseline = 'alphabetic';
    } else {
      this._drawIdle(ctx, W, H, CX, CY);
    }
  }

  _drawIdle(ctx, W, H, CX, CY) {
    const m = MODES[this._mode];
    const emoji = m === 'dice' ? '🎲' : m === 'coin' ? '🪙' : '🎱';
    ctx.font = `${Math.round(W * 0.22)}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const bob = Math.sin(this._t * 0.0015) * 8;
    ctx.fillText(emoji, CX, CY + bob);
    ctx.textBaseline = 'alphabetic';
  }

  _drawResult(ctx, W, H, CX, CY) {
    const r = this._result;
    if (r.type === 'dice') {
      ctx.font = `${Math.round(W * 0.28)}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowBlur = 30; ctx.shadowColor = '#3b82f6';
      ctx.fillStyle = '#fff';
      ctx.fillText(DICE_FACES[r.val], CX, CY - 20);
      ctx.shadowBlur = 0;
      ctx.font = `bold ${Math.round(W * 0.12)}px Outfit, sans-serif`;
      ctx.fillStyle = '#3b82f6';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(r.val + 1, CX, CY + Math.round(W * 0.12) + 10);
    } else {
      const ans    = BALL_ANSWERS[r.val];
      const isYes  = r.val < 5;
      const col    = isYes ? '#22c55e' : r.val < 9 ? '#f59e0b' : '#ef4444';
      ctx.font = `${Math.round(W * 0.22)}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🎱', CX, CY - 30);
      ctx.textBaseline = 'alphabetic';
      ctx.font = `bold ${Math.round(W * 0.075)}px Outfit, sans-serif`;
      ctx.fillStyle = col;
      ctx.shadowBlur = 16; ctx.shadowColor = col;
      ctx.fillText(ans, CX, CY + 55);
      ctx.shadowBlur = 0;
    }
  }

  onClick(nx, ny) {
    if (!this._running) return;
    // Zmiana trybu kliknięciem w zakładkę
    const { width: W } = this.canvas;
    const tabW = W / MODES.length;
    if (ny * this.canvas.height < 50) {
      const i = Math.floor((nx * W) / tabW);
      if (i >= 0 && i < MODES.length) {
        this._mode = i;
        this._result = null;
        this._rolling = false;
        return;
      }
    }
    this._roll();
  }

  onKeyDown(code) {
    if (code === 'Space')       { this._roll(); return; }
    if (code === 'ArrowRight')  { this._mode = (this._mode + 1) % MODES.length; this._result = null; }
    if (code === 'ArrowLeft')   { this._mode = (this._mode + MODES.length - 1) % MODES.length; this._result = null; }
    if (code === 'KeyR' && MODES[this._mode] === 'coin') {
      this._coinHist = []; this._coinCount = [0, 0]; this._result = null;
    }
  }

  onMouseMove() {}
  onKeyUp()    {}
}
