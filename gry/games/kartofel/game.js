import { drawGrid } from '../../static/gameutils.js';

const MIN_TIME = 10_000;
const MAX_TIME = 45_000;

export default class KartofelGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas  = canvas;
    this.ctx     = ctx;
    this.triki   = triki;
    this.emit    = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;
    this._limit     = 0;
    this._elapsed   = 0;
    this._passed    = false;
    this._lost      = false;
    this._lostT     = 0;
    this._canPass   = true;
    this._phase     = 0;
    this._t         = 0;
  }

  start(player) {
    this.player   = player;
    this._limit   = MIN_TIME + Math.random() * (MAX_TIME - MIN_TIME);
    this._elapsed = 0;
    this._passed  = false;
    this._lost    = false;
    this._lostT   = 0;
    this._canPass = true;
    this._phase   = 0;
    this._t       = 0;
    this.running  = true;
    this._startVibration();
  }

  resize(W, H) { this.W = W; this.H = H; }
  onMouseMove() {}
  onClick() { this._tryPass(); }
  onKeyDown(code) { if (code === 'Space') this._tryPass(); }

  _startVibration() {
    const pattern = [];
    for (let i = 0; i < 20; i++) { pattern.push(120, 80); }
    navigator.vibrate?.(pattern);
  }

  _tryPass() {
    if (!this.running || this._lost) return;
    if (!this._canPass) return;
    this._canPass = false;
    navigator.vibrate?.(0);
    navigator.vibrate?.([30, 20, 30]);
    this._passed = true;
    this._elapsed = 0;
    this._limit   = MIN_TIME + Math.random() * (MAX_TIME - MIN_TIME);

    setTimeout(() => {
      this._passed = false;
      this._startVibration();
    }, 800);
  }

  update(dt) {
    if (!this.running) return;
    this._t       += dt;
    this._phase   += dt;

    if (this._lost) {
      this._lostT += dt;
      if (this._lostT > 200 && this.triki.consumeClick()) {
        this.start(this.player);
      }
      return;
    }

    if (this._passed) return;

    if (this.triki.consumeClick?.()) this._tryPass();

    this._elapsed += dt;

    if (this._elapsed >= this._limit) {
      this._explode();
    }
  }

  _explode() {
    this._lost  = true;
    this._lostT = 0;
    navigator.vibrate?.(0);
    navigator.vibrate?.([200, 100, 200]);
  }

  _progress() {
    return Math.min(1, this._elapsed / this._limit);
  }

  draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    const prog = this._progress();

    const bgR = Math.round(10 + prog * 20);
    const bgG = Math.round(8  + prog * 2);
    const bgB = Math.round(18);
    ctx.fillStyle = `rgb(${bgR},${bgG},${bgB})`;
    ctx.fillRect(0, 0, W, H);
    drawGrid(ctx, W, H, 0.025);

    if (this._lost) {
      this._drawLost();
      return;
    }

    if (this._passed) {
      this._drawPassed();
      return;
    }

    this._drawKartofel(prog);
    this._drawHint();
  }

  _drawKartofel(prog) {
    const { ctx, W, H } = this;

    const pulseSpeed = 0.004 + prog * 0.018;
    const pulseAmt   = 0.06  + prog * 0.12;
    const pulse = 1 + Math.sin(this._phase * pulseSpeed) * pulseAmt;

    const baseR = Math.min(W, H) * 0.22;
    const r     = baseR * pulse;

    const cr = Math.round(200 + prog * 55);
    const cg = Math.round(150 - prog * 100);
    const cb = Math.round(50  - prog * 40);
    const color = `rgb(${cr},${cg},${cb})`;

    const cx = W / 2;
    const cy = H * 0.44;

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur  = 20 + prog * 40;

    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 1.2, r, 0, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(cx - r * 0.28, cy - r * 0.35, r * 0.18, r * 0.32, -0.3, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${Math.round(cr * 0.75)},${Math.round(cg * 0.75)},${Math.round(cb * 0.75)})`;
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(cx + r * 0.18, cy - r * 0.3, r * 0.14, r * 0.25, 0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.restore();

    const steamAlpha = 0.3 + prog * 0.5;
    const steamSpeed = 0.002 + prog * 0.004;
    for (let i = 0; i < 4; i++) {
      const offset = (this._phase * steamSpeed * (0.7 + i * 0.15)) % 1;
      const sx = cx + (i - 1.5) * r * 0.4;
      const sy = cy - r - offset * r * 1.4;
      const sa = steamAlpha * (1 - offset);
      ctx.save();
      ctx.globalAlpha = sa;
      ctx.beginPath();
      ctx.arc(sx, sy, r * 0.06, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.restore();
    }

    const emojiSize = Math.round(r * 1.1);
    ctx.font = `${emojiSize}px Outfit,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🥔', cx, cy);
  }

  _drawHint() {
    const { ctx, W, H } = this;
    const prog = this._progress();
    const urgency = prog > 0.7 ? '⚠️ Podaj SZYBKO! ⚠️' : 'Guzik kapsla = podaj dalej';
    const alpha = prog > 0.7 ? 0.9 : 0.45;
    const color = prog > 0.7 ? '#ef4444' : 'rgba(255,255,255,0.7)';

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.font = `600 ${Math.round(W / 18)}px Outfit,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(urgency, W / 2, H * 0.88);
    ctx.restore();

    if (!this._canPass) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#9ca3af';
      ctx.font = `500 ${Math.round(W / 22)}px Outfit,sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('(już raz podano)', W / 2, H * 0.93);
      ctx.restore();
    }
  }

  _drawPassed() {
    const { ctx, W, H } = this;

    ctx.fillStyle = 'rgba(34,197,94,0.12)';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#22c55e';
    ctx.font = `900 ${Math.round(W / 7)}px Outfit,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#22c55e'; ctx.shadowBlur = 30;
    ctx.fillText('PODANO! 👐', W / 2, H / 2);
    ctx.shadowBlur = 0;

    ctx.font = `500 ${Math.round(W / 16)}px Outfit,sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('Teraz TY trzymasz!', W / 2, H / 2 + Math.round(W / 7) * 0.9);
    ctx.restore();
  }

  _drawLost() {
    const { ctx, W, H } = this;

    const flash = Math.sin(this._lostT * 0.015) * 0.5 + 0.5;
    ctx.fillStyle = `rgba(239,68,68,${flash * 0.2})`;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.fillStyle = '#ef4444';
    ctx.font = `900 ${Math.round(W / 8)}px Outfit,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#ef4444'; ctx.shadowBlur = 32;
    ctx.fillText('PRZEGRAŁEŚ! 💥', W / 2, H * 0.38);
    ctx.shadowBlur = 0;

    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = `500 ${Math.round(W / 16)}px Outfit,sans-serif`;
    ctx.fillText('Kartofel wybuchł u Ciebie!', W / 2, H * 0.55);

    if (this._lostT > 1200) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = `400 ${Math.round(W / 20)}px Outfit,sans-serif`;
      ctx.fillText('Kliknij guzik aby zagrać ponownie', W / 2, H * 0.76);
    }
    ctx.restore();
  }

  drawIdle() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0e0818';
    ctx.fillRect(0, 0, W, H);
    drawGrid(ctx, W, H, 0.025);

    const r = Math.min(W, H) * 0.22;
    const bob = Math.sin(Date.now() * 0.002) * r * 0.08;
    const cx = W / 2;
    const cy = H * 0.42 + bob;

    ctx.save();
    ctx.shadowColor = '#f97316'; ctx.shadowBlur = 24;
    ctx.font = `${Math.round(r * 1.5)}px Outfit,sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🥔', cx, cy);
    ctx.shadowBlur = 0;
    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = `900 ${Math.round(W / 9)}px Outfit,sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = '#a855f7'; ctx.shadowBlur = 18;
    ctx.fillText('Gorący Kartofel', W / 2, H * 0.72);
    ctx.shadowBlur = 0;

    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `500 ${Math.round(W / 18)}px Outfit,sans-serif`;
    ctx.fillText('Podaj dalej zanim wybuchnie! 🔥', W / 2, H * 0.83);
  }

  destroy() {
    this.running = false;
    navigator.vibrate?.(0);
  }
}
