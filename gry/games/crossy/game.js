import { clamp, rand, pick, radialGlow, drawHintBubble } from '../../static/gameutils.js';

const COLS         = 5;
const VISIBLE_ROWS = 11;
const JUMP_MS      = 200;
const SIDE_LATCH_THRESH = 15;
const SIDE_LATCH_RELEASE = 6;
const CAR_COLORS   = ['#ef4444', '#3b82f6', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6'];
const LOG_COLOR    = '#92400e';
const SAFE_EVERY   = 5;

function makeRow(rowIdx) {
  if (rowIdx === 0) return { type: 'grass' };
  if (rowIdx % SAFE_EVERY === 0) return { type: 'grass' };

  const r = Math.random();
  if (r < 0.45) {
    const dir    = Math.random() < 0.5 ? 1 : -1;
    const speed  = rand(0.6, 1.6) * dir;
    const count  = Math.floor(rand(1, 4));
    const cars   = [];
    const gap    = 1 / count;
    for (let i = 0; i < count; i++) {
      cars.push({
        nx: (i * gap + Math.random() * gap * 0.5) % 1,
        color: pick(CAR_COLORS),
      });
    }
    return { type: 'road', dir, speed, cars };
  }
  const logDir   = Math.random() < 0.5 ? 1 : -1;
  const logSpeed = rand(0.3, 1.0) * logDir;
  const logCount = Math.floor(rand(1, 4));
  const logs     = [];
  const gap      = 1 / logCount;
  for (let i = 0; i < logCount; i++) {
    logs.push({
      nx: (i * gap + Math.random() * gap * 0.4) % 1,
      len: rand(0.18, 0.32),
    });
  }
  return { type: 'river', dir: logDir, speed: logSpeed, logs };
}

export default class CrossyGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas  = canvas;
    this.ctx     = ctx;
    this.triki   = triki;
    this.emit    = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;

    this.frogCol    = 0;
    this.frogRow    = 0;
    this.score      = 0;
    this.maxRow     = 0;

    this._rows      = [];
    this._viewRow   = 0;
    this._jumpAcc   = 0;
    this._jumping   = false;
    this._jumpFrom  = 0;
    this._jumpTo    = 0;
    this._jumpSide  = 0;
    this._dead      = false;
    this._deathTimer = 0;

    this._tiltLatch = false;
    this._keyLatch  = { left: false, right: false };

    this._init();
  }

  _init() {
    this._rows = [];
    for (let i = 0; i < VISIBLE_ROWS + 5; i++) {
      this._rows.push(makeRow(i));
    }
    this.frogCol  = 0;
    this.frogRow  = 0;
    this._viewRow = 0;
    this.score    = 0;
    this.maxRow   = 0;
    this._jumping = false;
    this._jumpAcc = 0;
    this._dead    = false;
    this._deathTimer = 0;
    this._tiltLatch = false;
    this._keyLatch  = { left: false, right: false };
  }

  start(player) {
    this.player = player;
    this._init();
    this.running = true;
    this._emitStats();
  }

  resize(W, H) { this.W = W; this.H = H; }

  onMouseMove() {}
  onClick() { this._tryJumpForward(); }

  onKeyDown(code) {
    if (code === 'ArrowUp'   || code === 'KeyW' || code === 'Space') this._tryJumpForward();
    if (code === 'ArrowLeft' || code === 'KeyA') {
      if (!this._keyLatch.left) { this._keyLatch.left = true; this._tryJumpSide(-1); }
    }
    if (code === 'ArrowRight'|| code === 'KeyD') {
      if (!this._keyLatch.right) { this._keyLatch.right = true; this._tryJumpSide(1); }
    }
  }

  onKeyUp(code) {
    if (code === 'ArrowLeft' || code === 'KeyA') this._keyLatch.left  = false;
    if (code === 'ArrowRight'|| code === 'KeyD') this._keyLatch.right = false;
  }

  update(dt) {
    if (!this.running) return;

    if (this._dead) {
      this._deathTimer -= dt;
      if (this._deathTimer <= 0) {
        this.running = false;
        this.emit('end', { score: this.score });
      }
      return;
    }

    const rowH = this.H / VISIBLE_ROWS;

    this._rows.forEach(row => {
      if (row.type === 'road') {
        row.cars.forEach(c => {
          c.nx += row.speed * dt * 0.00025;
          c.nx = ((c.nx % 1) + 1) % 1;
        });
      } else if (row.type === 'river') {
        row.logs.forEach(l => {
          l.nx += row.speed * dt * 0.00018;
          l.nx = ((l.nx % 1) + 1) % 1;
        });
      }
    });

    if (this._jumping) {
      this._jumpAcc += dt;
      if (this._jumpAcc >= JUMP_MS) {
        this._jumpAcc  = JUMP_MS;
        this._jumping  = false;
        this.frogRow   = this._jumpTo;
        this.frogCol   = clamp(this.frogCol + this._jumpSide, -(COLS - 1) / 2, (COLS - 1) / 2);
        this._jumpSide = 0;

        if (this.frogRow > this.maxRow) {
          this.maxRow = this.frogRow;
          this.score  = this.maxRow;
          this._emitStats();
        }

        const targetViewRow = this.frogRow - Math.floor(VISIBLE_ROWS * 0.25);
        if (targetViewRow > this._viewRow) this._viewRow = targetViewRow;

        while (this._rows.length < this.frogRow + VISIBLE_ROWS + 5) {
          this._rows.push(makeRow(this._rows.length));
        }

        this._checkDeath(rowH);
      }
    } else {
      this._checkDeath(rowH);
    }

    const gz = -this.triki.GZ();
    if (this.triki.connected) {
      if (Math.abs(gz) >= SIDE_LATCH_THRESH) {
        if (!this._tiltLatch) {
          this._tiltLatch = true;
          this._tryJumpSide(gz > 0 ? 1 : -1);
        }
      } else if (Math.abs(gz) < SIDE_LATCH_RELEASE) {
        this._tiltLatch = false;
      }

      if (this.triki.consumeClick()) this._tryJumpForward();
    }
  }

  _tryJumpForward() {
    if (this._jumping || this._dead) return;
    this._jumping  = true;
    this._jumpAcc  = 0;
    this._jumpFrom = this.frogRow;
    this._jumpTo   = this.frogRow + 1;
    this._jumpSide = 0;
  }

  _tryJumpSide(dir) {
    if (this._dead) return;
    const newCol = clamp(this.frogCol + dir, -(COLS - 1) / 2, (COLS - 1) / 2);
    if (newCol === this.frogCol) return;
    if (this._jumping) {
      this.frogCol = newCol;
      return;
    }
    this._jumping  = true;
    this._jumpAcc  = 0;
    this._jumpFrom = this.frogRow;
    this._jumpTo   = this.frogRow;
    this._jumpSide = dir;
  }

  _checkDeath(rowH) {
    if (this._dead || this._jumping) return;
    const row = this._rows[this.frogRow];
    if (!row) return;

    if (row.type === 'road') {
      const frogNX = this._colToNX(this.frogCol);
      const frogW  = 0.7 / COLS;
      const carW   = 0.9 / COLS;
      for (const c of row.cars) {
        const cx = c.nx;
        if (this._overlapWrapped(frogNX - frogW / 2, frogW, cx - carW / 2, carW)) {
          this._die();
          return;
        }
      }
    }

    if (row.type === 'river') {
      const frogNX = this._colToNX(this.frogCol);
      const frogW  = 0.7 / COLS;
      let onLog = false;
      for (const l of row.logs) {
        if (this._overlapWrapped(frogNX - frogW / 2, frogW, l.nx, l.len)) {
          const logDX = row.speed * 0.00018 * 16;
          this.frogCol = clamp(
            this.frogCol + logDX * COLS,
            -(COLS - 1) / 2,
            (COLS - 1) / 2
          );
          onLog = true;
          break;
        }
      }
      if (!onLog) { this._die(); return; }
    }
  }

  _overlapWrapped(ax, aw, bx, bw) {
    for (let shift of [0, 1, -1]) {
      const bxs = bx + shift;
      if (ax < bxs + bw && ax + aw > bxs) return true;
    }
    return false;
  }

  _colToNX(col) {
    return 0.5 + col / COLS;
  }

  _die() {
    this._dead       = true;
    this._deathTimer = 900;
  }

  draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    const rowH = H / VISIBLE_ROWS;

    for (let vi = 0; vi < VISIBLE_ROWS; vi++) {
      const absRow = this._viewRow + vi;
      const screenY = H - (vi + 1) * rowH;
      const row = this._rows[absRow];
      if (!row) continue;
      this._drawRow(row, absRow, screenY, rowH);
    }

    this._drawFrog(rowH);

    this._drawHUD();
  }

  _drawRow(row, absRow, screenY, rowH) {
    const { ctx, W } = this;

    if (row.type === 'grass') {
      const g = ctx.createLinearGradient(0, screenY, 0, screenY + rowH);
      const even = absRow % 2 === 0;
      g.addColorStop(0, even ? '#15803d' : '#166534');
      g.addColorStop(1, even ? '#166534' : '#14532d');
      ctx.fillStyle = g;
      ctx.fillRect(0, screenY, W, rowH);
      return;
    }

    if (row.type === 'road') {
      ctx.fillStyle = '#374151';
      ctx.fillRect(0, screenY, W, rowH);
      ctx.save();
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth   = 2;
      ctx.setLineDash([W * 0.06, W * 0.04]);
      ctx.beginPath();
      ctx.moveTo(0, screenY + rowH / 2);
      ctx.lineTo(W, screenY + rowH / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      const carH = rowH * 0.72;
      const carW = W / COLS * 0.82;
      row.cars.forEach(c => {
        const cx = c.nx * W - carW / 2;
        const cy = screenY + (rowH - carH) / 2;
        ctx.save();
        ctx.fillStyle = c.color;
        ctx.shadowColor = c.color;
        ctx.shadowBlur  = 8;
        ctx.beginPath();
        ctx.roundRect(cx, cy, carW, carH, carH * 0.28);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = `${Math.round(carH * 0.65)}px Outfit, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🚗', cx + carW / 2, cy + carH / 2);
        ctx.restore();

        const cx2 = (c.nx - 1) * W - carW / 2;
        ctx.save();
        ctx.fillStyle = c.color;
        ctx.beginPath();
        ctx.roundRect(cx2, cy, carW, carH, carH * 0.28);
        ctx.fill();
        ctx.restore();

        const cx3 = (c.nx + 1) * W - carW / 2;
        ctx.save();
        ctx.fillStyle = c.color;
        ctx.beginPath();
        ctx.roundRect(cx3, cy, carW, carH, carH * 0.28);
        ctx.fill();
        ctx.restore();
      });
      return;
    }

    if (row.type === 'river') {
      const g = ctx.createLinearGradient(0, screenY, 0, screenY + rowH);
      g.addColorStop(0, '#1d4ed8');
      g.addColorStop(1, '#1e40af');
      ctx.fillStyle = g;
      ctx.fillRect(0, screenY, W, rowH);

      ctx.save();
      ctx.globalAlpha = 0.15;
      ctx.strokeStyle = '#93c5fd';
      ctx.lineWidth   = 1.5;
      for (let wave = 0; wave < 3; wave++) {
        const wy = screenY + rowH * (0.3 + wave * 0.2);
        ctx.beginPath();
        ctx.moveTo(0, wy);
        for (let x = 0; x <= W; x += 8) {
          ctx.lineTo(x, wy + Math.sin(x / 18 + wave) * 2);
        }
        ctx.stroke();
      }
      ctx.restore();

      const logH = rowH * 0.65;
      row.logs.forEach(l => {
        const lx = l.nx * W;
        const lw = l.len * W;
        const ly = screenY + (rowH - logH) / 2;

        for (let shift of [0, 1, -1]) {
          const lxs = lx + shift * W;
          ctx.save();
          ctx.fillStyle = LOG_COLOR;
          ctx.shadowColor = '#78350f';
          ctx.shadowBlur  = 4;
          ctx.beginPath();
          ctx.roundRect(lxs, ly, lw, logH, logH * 0.35);
          ctx.fill();
          ctx.fillStyle = 'rgba(0,0,0,0.15)';
          const ringCount = Math.max(2, Math.floor(lw / 18));
          for (let r = 0; r < ringCount; r++) {
            const rx = lxs + lw * (r + 1) / (ringCount + 1);
            ctx.beginPath();
            ctx.arc(rx, ly + logH / 2, logH * 0.28, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      });
    }
  }

  _drawFrog(rowH) {
    const { ctx, W, H } = this;

    let frogVisRow, jumpProgress;
    if (this._jumping) {
      jumpProgress = this._jumpAcc / JUMP_MS;
      const fromVI = this._jumpFrom - this._viewRow;
      const toVI   = this._jumpTo   - this._viewRow;
      frogVisRow   = fromVI + (toVI - fromVI) * jumpProgress;
    } else {
      frogVisRow   = this.frogRow - this._viewRow;
      jumpProgress = 0;
    }

    const fromCol = this.frogCol - (this._jumping ? this._jumpSide * (this._jumpAcc / JUMP_MS) : 0);
    const toCol   = this.frogCol + (this._jumping ? this._jumpSide * (1 - this._jumpAcc / JUMP_MS) : 0);
    const currentCol = this._jumping
      ? (this.frogCol - this._jumpSide) + this._jumpSide * (this._jumpAcc / JUMP_MS)
      : this.frogCol;

    const screenY = H - (frogVisRow + 1) * rowH;
    const cx = W / 2 + currentCol * (W / COLS);
    const arc = this._jumping ? Math.sin(jumpProgress * Math.PI) * rowH * 0.7 : 0;
    const cy = screenY + rowH / 2 - arc;

    const fr = Math.min(rowH * 0.38, W / COLS * 0.38);

    if (this._dead) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, this._deathTimer / 900);
      ctx.font = `${fr * 2.2}px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('💀', cx, cy);
      ctx.restore();
      return;
    }

    radialGlow(ctx, cx, cy + arc * 0.1, fr * 2.5, '#22c55e', 0.35);

    ctx.save();
    ctx.fillStyle = '#16a34a';
    ctx.shadowColor = '#22c55e';
    ctx.shadowBlur  = 12;
    ctx.beginPath();
    ctx.ellipse(cx, cy, fr, fr * 0.82, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const eyeR  = fr * 0.22;
    const eyeOX = fr * 0.42;
    const eyeOY = -fr * 0.35;
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(cx - eyeOX, cy + eyeOY, eyeR, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + eyeOX, cy + eyeOY, eyeR, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(cx - eyeOX + eyeR * 0.2, cy + eyeOY, eyeR * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + eyeOX + eyeR * 0.2, cy + eyeOY, eyeR * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = '#86efac';
    ctx.lineWidth   = fr * 0.12;
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy + fr * 0.15, fr * 0.4, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.stroke();
    ctx.restore();
  }

  _drawHUD() {
    const { ctx, W, H } = this;
    const pad = 10;
    const barH = 28;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.roundRect(pad, pad, W - 2 * pad, barH, 6);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(barH * 0.62)}px Outfit, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`🐸 ${this.score} kroków`, W / 2, pad + barH / 2);

    ctx.restore();
  }

  drawIdle() {
    this.draw();
    const { ctx, W, H } = this;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, H);
    drawHintBubble(ctx, W / 2, H / 2, 'Guzik = skok · Przechyl L/R = bok', {
      fontSize: 15,
      bg: 'rgba(20,83,45,0.88)',
      border: '#22c55e',
      color: '#bbf7d0',
    });
    ctx.restore();
  }

  destroy() { this.running = false; }

  _emitStats() {
    this.emit('stats', `🐸 <b>${this.score}</b> kroków`);
  }
}
