import { clamp } from '../../static/gameutils.js';

const SHAKE_G   = 1.35;
const DEBOUNCE  = 700;

const MODES = ['dice', 'coin', 'ball'];
const MODE_LABELS = { dice: '🎲 Kość', coin: '🪙 Moneta', ball: '🎱 Magic 8' };

const DICE_FACES = ['⚀','⚁','⚂','⚃','⚄','⚅'];
const COIN_FACES = ['ORZEŁ', 'RESZKA'];
const BALL_ANSWERS = [
  'TAK!','ABSOLUTNIE','ZDECYDOWANIE','NA PEWNO','RACZEJ TAK',
  'MOŻE','TRUDNO POWIEDZIEĆ','ZAPYTAJ JUTRO','NIE TERAZ',
  'RACZEJ NIE','NIE','ABSOLUTNIE NIE','NIGDY W ŻYCIU',
];

const ROLL_DURATION = 600;  // ms animacji losowania

export default class LosowaczkaGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas  = canvas;
    this.ctx     = ctx;
    this.triki   = triki;
    this.emit    = emit;

    this._mode    = 0;     // index MODES
    this._result  = null;  // wynik
    this._rolling = false;
    this._rollT   = 0;
    this._prevG   = 0;
    this._lastT   = -9999;
    this._t       = 0;
    this._running = false;
    this._hint    = 1;     // alpha podpowiedzi
  }

  start()  { this._running = true; this._result = null; this._hint = 1; }
  stop()   { this._running = false; }
  resize() {}

  _roll() {
    if (this._rolling) return;
    this._rolling = true;
    this._rollT   = 0;
    this._hint    = 0;
    const m = MODES[this._mode];
    if (m === 'dice') {
      this._result = { type: 'dice', val: Math.floor(Math.random() * 6) };
    } else if (m === 'coin') {
      this._result = { type: 'coin', val: Math.floor(Math.random() * 2) };
    } else {
      this._result = { type: 'ball', val: Math.floor(Math.random() * BALL_ANSWERS.length) };
    }
  }

  update(dt) {
    this._t += dt;
    if (!this._running) return;

    if (this._rolling) {
      this._rollT += dt;
      if (this._rollT >= ROLL_DURATION) this._rolling = false;
    }

    // BLE shake
    const g = Math.hypot(this.triki.ax, this.triki.ay, this.triki.az);
    if (g >= SHAKE_G && this._prevG < SHAKE_G && this._t - this._lastT > DEBOUNCE) {
      this._lastT = this._t;
      this._roll();
    }
    this._prevG = g;

    // BLE button
    if (this.triki.consumeClick?.() && this._t - this._lastT > DEBOUNCE) {
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
      ctx.fillStyle = active ? 'rgba(59,130,246,0.25)' : 'rgba(255,255,255,0.04)';
      ctx.beginPath();
      ctx.roundRect(i * tabW + 4, 8, tabW - 8, 38, 8);
      ctx.fill();
      ctx.fillStyle = active ? '#3b82f6' : 'rgba(255,255,255,0.35)';
      ctx.font = `${active ? 'bold ' : ''}${Math.round(W * 0.042)}px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(MODE_LABELS[m], i * tabW + tabW / 2, 32);
    });

    // Animacja i wynik
    const prog = this._rolling ? this._rollT / ROLL_DURATION : 1;
    const shake = this._rolling ? Math.sin(this._t * 0.05) * (1 - prog) * 18 : 0;

    if (this._result && !this._rolling) {
      this._drawResult(ctx, W, H, CX, CY);
    } else if (this._rolling) {
      // Animacja — losowe miganie
      this._drawRolling(ctx, W, H, CX, CY, shake);
    } else {
      this._drawIdle(ctx, W, H, CX, CY);
    }

    // Podpowiedź
    if (this._hint > 0) {
      ctx.globalAlpha = this._hint * 0.5;
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.round(W * 0.038)}px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('potrząśnij lub kliknij', CX, H - 28);
      ctx.globalAlpha = 1;
    }
  }

  _drawIdle(ctx, W, H, CX, CY) {
    const m = MODES[this._mode];
    let emoji = m === 'dice' ? '🎲' : m === 'coin' ? '🪙' : '🎱';
    ctx.font = `${Math.round(W * 0.22)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const bob = Math.sin(this._t * 0.0015) * 8;
    ctx.fillText(emoji, CX, CY + bob);
    ctx.textBaseline = 'alphabetic';
  }

  _drawRolling(ctx, W, H, CX, CY, shake) {
    const m = MODES[this._mode];
    ctx.save(); ctx.translate(shake, 0);
    if (m === 'dice') {
      const rnd = Math.floor(Math.random() * 6);
      ctx.font = `${Math.round(W * 0.22)}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(DICE_FACES[rnd], CX, CY);
    } else if (m === 'coin') {
      ctx.font = `bold ${Math.round(W * 0.1)}px Outfit, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,215,0,0.5)';
      ctx.fillText(Math.random() < 0.5 ? 'ORZEŁ' : 'RESZKA', CX, CY);
    } else {
      ctx.font = `${Math.round(W * 0.22)}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText('🎱', CX, CY);
    }
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
  }

  _drawResult(ctx, W, H, CX, CY) {
    const m = MODES[this._mode];
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
      ctx.fillText(r.val + 1, CX, CY + Math.round(W * 0.12) + 10);

    } else if (r.type === 'coin') {
      const orzel = r.val === 0;
      ctx.font = `${Math.round(W * 0.2)}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(orzel ? '🦅' : '🏛️', CX, CY - 20);
      ctx.font = `bold ${Math.round(W * 0.1)}px Outfit, sans-serif`;
      ctx.fillStyle = '#ffd700';
      ctx.shadowBlur = 20; ctx.shadowColor = '#ffd700';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(COIN_FACES[r.val], CX, CY + 60);
      ctx.shadowBlur = 0;

    } else {
      const ans  = BALL_ANSWERS[r.val];
      const isYes = r.val < 5;
      const col   = isYes ? '#22c55e' : r.val < 9 ? '#f59e0b' : '#ef4444';
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

  onClick()    { if (this._running) this._roll(); }

  onKeyDown(code) {
    if (code === 'Space')       { this._roll(); return; }
    if (code === 'ArrowRight')  { this._mode = (this._mode + 1) % MODES.length; this._result = null; }
    if (code === 'ArrowLeft')   { this._mode = (this._mode + MODES.length - 1) % MODES.length; this._result = null; }
  }
}
