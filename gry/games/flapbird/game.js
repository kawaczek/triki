import { clamp, rand, drawGrid, radialGlow } from '../../static/gameutils.js';

const GRAVITY     = 0.0005;
const FLAP_VEL    = -0.5;
const PIPE_SPEED  = 0.00022;
const GAP_FRAC    = 0.35;
const PIPE_W_FRAC = 0.13;
const PIPE_INTERVAL = 2200;

export default class FlapbirdGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas  = canvas;
    this.ctx     = ctx;
    this.triki   = triki;
    this.emit    = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;
    this.vy      = 0;
    this.y       = 0.5;
    this.pipes   = [];
    this.score   = 0;
    this._pipeAcc = 0;
    this._dead   = false;
    this._deathT = 0;
    this._t      = 0;
  }

  start(player) {
    this.player  = player;
    this.vy      = 0;
    this.y       = 0.5;
    this.pipes   = [];
    this.score   = 0;
    this._pipeAcc = PIPE_INTERVAL * 0.4;
    this._dead   = false;
    this._deathT = 0;
    this._t      = 0;
    this.running = true;
    this.emit('stats', '🐸 <b>0</b> rur');
  }

  resize(W, H) { this.W = W; this.H = H; }
  onMouseMove() {}
  onKeyDown(code) { if (code === 'Space') this._flap(); }
  onClick() { this._flap(); }

  _flap() {
    if (!this.running) return;
    this.vy = FLAP_VEL / 1000;
    navigator.vibrate?.(30);
  }

  update(dt) {
    if (!this.running) return;
    this._t += dt;

    if (this._dead) {
      this._deathT += dt;
      if (this._deathT > 1200) {
        this.running = false;
        this.emit('end', { score: this.score });
      }
      return;
    }

    if (this.triki.consumeClick()) this._flap();

    this.vy += GRAVITY * dt;
    this.y  += this.vy * dt;

    if (this.y <= 0 || this.y >= 1) {
      this._die();
      return;
    }

    this._pipeAcc += dt;
    if (this._pipeAcc >= PIPE_INTERVAL) {
      this._pipeAcc -= PIPE_INTERVAL;
      this._spawnPipe();
    }

    const speed = PIPE_SPEED * (1 + this.score * 0.02);
    this.pipes.forEach(p => { p.x -= speed * dt; });
    this.pipes = this.pipes.filter(p => p.x > -PIPE_W_FRAC - 0.05);

    const bx = 0.22;
    const br = 0.045;
    const pw = PIPE_W_FRAC;

    for (const p of this.pipes) {
      if (!p.scored && p.x + pw < bx - br) {
        p.scored = true;
        this.score++;
        this.emit('stats', `🐸 <b>${this.score}</b> rur`);
        navigator.vibrate?.(15);
      }
      const inX = bx + br > p.x && bx - br < p.x + pw;
      if (inX) {
        const topBot = p.gapTop;
        const botTop = p.gapTop + GAP_FRAC;
        if (this.y - br < topBot || this.y + br > botTop) {
          this._die();
          return;
        }
      }
    }
  }

  _die() {
    this._dead   = true;
    this._deathT = 0;
    navigator.vibrate?.([80, 60, 200]);
  }

  _spawnPipe() {
    const minGapTop = 0.07;
    const maxGapTop = 1 - GAP_FRAC - 0.07;
    this.pipes.push({
      x: 1.02,
      gapTop: rand(minGapTop, maxGapTop),
      scored: false,
    });
  }

  draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = '#0d1b0d';
    ctx.fillRect(0, 0, W, H);
    drawGrid(ctx, W, H, 0.02);

    this._drawPipes();
    this._drawBird();

    if (this._dead) {
      const alpha = Math.min(1, this._deathT / 400);
      ctx.save();
      ctx.globalAlpha = alpha * 0.55;
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = Math.min(1, (this._deathT - 200) / 300);
      ctx.fillStyle = '#fbbf24';
      ctx.font = `900 ${Math.round(W / 8)}px Outfit,sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = '#f59e0b'; ctx.shadowBlur = 28;
      ctx.fillText('ŁUPS! 💥', W / 2, H / 2.5);
      ctx.shadowBlur = 0;
      ctx.font = `600 ${Math.round(W / 14)}px Outfit,sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(`${this.score} rur`, W / 2, H / 2.5 + Math.round(W / 8) * 1.2);
      ctx.restore();
    }
  }

  _drawPipes() {
    const { ctx, W, H } = this;
    const pw = PIPE_W_FRAC * W;
    const capH = 18;
    const capEx = 6;

    this.pipes.forEach(p => {
      const x    = p.x * W;
      const topH = p.gapTop * H;
      const botY = (p.gapTop + GAP_FRAC) * H;
      const botH = H - botY;

      const grad = ctx.createLinearGradient(x, 0, x + pw, 0);
      grad.addColorStop(0,   '#166534');
      grad.addColorStop(0.4, '#22c55e');
      grad.addColorStop(1,   '#14532d');

      ctx.fillStyle = grad;

      ctx.beginPath();
      ctx.roundRect(x, 0, pw, topH - capH, [0, 0, 4, 4]);
      ctx.fill();

      ctx.beginPath();
      ctx.roundRect(x - capEx, topH - capH, pw + capEx * 2, capH, [4, 4, 0, 0]);
      ctx.fill();

      ctx.beginPath();
      ctx.roundRect(x - capEx, botY, pw + capEx * 2, capH, [0, 0, 4, 4]);
      ctx.fill();

      ctx.beginPath();
      ctx.roundRect(x, botY + capH, pw, botH - capH, [4, 4, 0, 0]);
      ctx.fill();

      ctx.strokeStyle = 'rgba(34,197,94,0.35)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, 0, pw, topH - capH);
      ctx.strokeRect(x, botY + capH, pw, botH - capH);
    });
  }

  _drawBird() {
    const { ctx, W, H } = this;
    const bx = 0.22 * W;
    const by = this.y * H;
    const r  = clamp(W * 0.045, 16, 34);
    const angle = clamp(this.vy * 1000 * 1.2, -0.9, 1.3);
    const wingFlap = Math.sin(this._t * 0.018) * 0.35;

    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(angle);

    if (this._dead) {
      ctx.globalAlpha = Math.max(0, 1 - this._deathT / 600);
    }

    radialGlow(ctx, 0, 0, r * 2.5, '#22c55e', 0.35);

    ctx.save();
    ctx.rotate(-wingFlap);
    ctx.beginPath();
    ctx.ellipse(-r * 0.35, -r * 0.2, r * 0.7, r * 0.32, -0.4, 0, Math.PI * 2);
    ctx.fillStyle = '#16a34a';
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = '#fbbf24';
    ctx.shadowColor = '#fde68a'; ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.arc(r * 0.28, -r * 0.22, r * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(r * 0.32, -r * 0.2, r * 0.14, 0, Math.PI * 2);
    ctx.fillStyle = '#1e293b';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(r * 0.7,  r * 0.05);
    ctx.lineTo(r * 1.15, r * 0.05);
    ctx.lineTo(r * 0.85, r * 0.22);
    ctx.closePath();
    ctx.fillStyle = '#f97316';
    ctx.fill();

    ctx.restore();
  }

  drawIdle() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = '#0d1b0d';
    ctx.fillRect(0, 0, W, H);
    drawGrid(ctx, W, H, 0.02);

    const bx = 0.22 * W;
    const by = 0.5 * H + Math.sin(Date.now() * 0.0025) * H * 0.06;
    const r  = clamp(W * 0.045, 16, 34);

    radialGlow(ctx, bx, by, r * 2.5, '#22c55e', 0.35);

    ctx.save();
    ctx.translate(bx, by);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = '#fbbf24';
    ctx.shadowColor = '#fde68a'; ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(r * 0.28, -r * 0.22, r * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.32, -r * 0.2, r * 0.14, 0, Math.PI * 2);
    ctx.fillStyle = '#1e293b'; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(r * 0.7,  r * 0.05);
    ctx.lineTo(r * 1.15, r * 0.05);
    ctx.lineTo(r * 0.85, r * 0.22);
    ctx.closePath();
    ctx.fillStyle = '#f97316'; ctx.fill();
    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `900 ${Math.round(W / 8)}px Outfit,sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = '#22c55e'; ctx.shadowBlur = 20;
    ctx.fillText('Flappy Żabka', W / 2, H * 0.26);
    ctx.shadowBlur = 0;

    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = `500 ${Math.round(W / 18)}px Outfit,sans-serif`;
    ctx.fillText('Kliknij guzik kapsla aby frunąć!', W / 2, H * 0.72);
    ctx.fillText('Przelatuj między rurami 🌿', W / 2, H * 0.79);
  }

  destroy() { this.running = false; }
}
