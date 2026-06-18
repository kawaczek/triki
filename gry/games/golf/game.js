// games/golf/game.js — Mini Golf Triki
// Widok z góry: 5 dołków, przechył = kąt uderzenia, potrząśnięcie = uderzenie
// Sterowanie:
//   -GZ(0) (prawo/lewo) → kąt celowania (stale modyfikowany)
//   consumeShake() + intensywność gz → siła uderzenia
//   Bez BLE: klawisze strzałek = kąt, Spacja = uderzenie

import { clamp, radialGlow, drawHintBubble } from '../../static/gameutils.js';

const BALL_R    = 9;
const HOLE_R    = 14;
const FRICTION  = 0.985;    // mnożnik prędkości / klatkę (przy 60fps)
const ELASTICITY = 0.58;
const MIN_SPEED  = 0.012;   // px/ms poniżej której piłka staje

// 5 layoutów dołków
// Każdy: { tee, hole, par, walls[], movers[] }
// walls: [{x1,y1,x2,y2}]  — statyczne ściany (px, względem W/H — skalowane przy resize)
// movers: [{cx,cy,w,h,axis,range,speed}] — ruchome bariery
const HOLES_DEF = [
  // Dołek 1: prosta, par 2
  {
    par: 2,
    tee:  { rx: 0.5, ry: 0.82 },
    hole: { rx: 0.5, ry: 0.18 },
    walls: [],
    movers: [],
  },
  // Dołek 2: zakręt 90°, par 3
  {
    par: 3,
    tee:  { rx: 0.15, ry: 0.80 },
    hole: { rx: 0.82, ry: 0.18 },
    walls: [
      // Pozioma ściana blokująca skrót — wymusza zakręt
      { rx1: 0.15, ry1: 0.45, rx2: 0.65, ry2: 0.45 },
      // Pionowa boczna ściana prawa
      { rx1: 0.65, ry1: 0.45, rx2: 0.65, ry2: 0.85 },
    ],
    movers: [],
  },
  // Dołek 3: ściany boczne + ruchoma bariera, par 3
  {
    par: 3,
    tee:  { rx: 0.5, ry: 0.84 },
    hole: { rx: 0.5, ry: 0.14 },
    walls: [
      // Lewa ściana boczna — kanał
      { rx1: 0.30, ry1: 0.12, rx2: 0.30, ry2: 0.88 },
      // Prawa ściana boczna — kanał
      { rx1: 0.70, ry1: 0.12, rx2: 0.70, ry2: 0.88 },
    ],
    movers: [
      { rcx: 0.5, rcy: 0.5, rw: 0.28, rh: 0.04, axis: 'x', range: 0.18, speed: 0.00042 },
    ],
  },
  // Dołek 4: L-kształt, par 4
  {
    par: 4,
    tee:  { rx: 0.15, ry: 0.82 },
    hole: { rx: 0.82, ry: 0.18 },
    walls: [
      // Pozioma bariera środkowa (wymusza L)
      { rx1: 0.15, ry1: 0.50, rx2: 0.55, ry2: 0.50 },
      { rx1: 0.55, ry1: 0.50, rx2: 0.55, ry2: 0.18 },
      // Mała przeszkoda w rogu
      { rx1: 0.72, ry1: 0.50, rx2: 0.82, ry2: 0.50 },
      { rx1: 0.72, ry1: 0.30, rx2: 0.72, ry2: 0.50 },
    ],
    movers: [],
  },
  // Dołek 5: okrągła wyspa w środku, par 4
  {
    par: 4,
    tee:  { rx: 0.5, ry: 0.84 },
    hole: { rx: 0.5, ry: 0.14 },
    walls: [],
    island: { rx: 0.5, ry: 0.5, rr: 0.14 },   // okrągła przeszkoda
    movers: [
      { rcx: 0.26, rcy: 0.48, rw: 0.06, rh: 0.22, axis: 'y', range: 0.16, speed: 0.00035 },
      { rcx: 0.74, rcy: 0.52, rw: 0.06, rh: 0.22, axis: 'y', range: 0.16, speed: 0.00035 },
    ],
  },
];

export default class GolfGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas  = canvas;
    this.ctx     = ctx;
    this.triki   = triki;
    this.emit    = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;

    // Stan gry
    this.holeIdx    = 0;
    this.totalStrokes = 0;
    this.strokes    = 0;
    this.aimAngle   = -Math.PI / 2;   // celuj w górę na start
    this.ball       = { x: 0, y: 0, vx: 0, vy: 0 };
    this.ballMoving = false;
    this._holeClear = false;   // animacja wpadnięcia
    this._holeClearTimer = 0;
    this._moverPhase = [];
    this._hintTimer  = 3000;   // ms wyświetlania hintu
    this._skipTimer  = 0;
    this._skipCountdown = false;
    this._aimSpeed  = 0;   // prędkość kątowa (klawisze)

    this._setupHole(0);
  }

  _setupHole(idx) {
    this.holeIdx   = idx;
    this.strokes   = 0;
    this.ballMoving = false;
    this._holeClear = false;
    this._holeClearTimer = 0;
    this._hintTimer = 2800;
    this._skipCountdown = false;
    this._skipTimer = 0;
    this._moverPhase = (HOLES_DEF[idx].movers || []).map(() => Math.random() * Math.PI * 2);

    const def = HOLES_DEF[idx];
    this.ball.x  = def.tee.rx  * this.W;
    this.ball.y  = def.tee.ry  * this.H;
    this.ball.vx = 0;
    this.ball.vy = 0;

    // Kąt celowania: od tee do hole
    const hx = def.hole.rx * this.W;
    const hy = def.hole.ry * this.H;
    this.aimAngle = Math.atan2(hy - this.ball.y, hx - this.ball.x);
    this._aimSpeed = 0;
  }

  start(player) {
    this.player  = player;
    this.W = this.canvas.width;
    this.H = this.canvas.height;
    this.holeIdx = 0;
    this.totalStrokes = 0;
    this._setupHole(0);
    this.running = true;
    this._emitStats();
  }

  resize(W, H) { this.W = W; this.H = H; this._setupHole(this.holeIdx); }
  drawIdle() { this.draw(); }
  destroy() { this.running = false; }

  // ─── update ───────────────────────────────────────────────────
  update(dt) {
    if (!this.running) return;
    const dt_s = dt / 1000;

    // Animacja wpadnięcia piłki do dołka
    if (this._holeClear) {
      this._holeClearTimer -= dt;
      if (this._holeClearTimer <= 0) {
        this._nextHole();
      }
      return;
    }

    // Podpowiedź hint
    if (this._hintTimer > 0) this._hintTimer -= dt;

    // Automatyczny skip po 8 uderzeniach
    if (this._skipCountdown) {
      this._skipTimer -= dt;
      if (this._skipTimer <= 0) {
        this.totalStrokes += 8;
        this.strokes = 8;
        this._holeClear = true;
        this._holeClearTimer = 1200;
        this._emitStats();
        return;
      }
    }

    // Animacja moverów
    const def = HOLES_DEF[this.holeIdx];
    (def.movers || []).forEach((m, i) => {
      this._moverPhase[i] += m.speed * dt;
    });

    if (!this.ballMoving) {
      // ── Celowanie ──────────────────────────────────────────
      if (this.triki.connected) {
        const gz = -this.triki.GZ(0);
        this.aimAngle += gz * 0.0024 * dt;
      } else {
        // Klawisze
        this.aimAngle += this._aimSpeed * dt;
      }

      // Potrząśnięcie = uderzenie
      const shakeIntensity = this.triki.consumeShake();
      if (shakeIntensity > 0) {
        const minSpd = 0.002, maxSpd = 0.010;
        const power = clamp(shakeIntensity / 80, 0, 1);
        const spd = minSpd + power * (maxSpd - minSpd);
        this._strike(spd);
      }
    } else {
      // ── Fizyka piłki ───────────────────────────────────────
      const steps = 3;
      const subDt = dt_s / steps;
      for (let s = 0; s < steps; s++) {
        this.ball.x += this.ball.vx * subDt * 1000;
        this.ball.y += this.ball.vy * subDt * 1000;
        this.ball.vx *= Math.pow(FRICTION, subDt * 60);
        this.ball.vy *= Math.pow(FRICTION, subDt * 60);

        // Ściany obramowania canvasu (z marginesem)
        this._bounceWalls();

        // Ściany dołka
        this._collideLevelWalls();

        // Kolizja z wyspą (jeśli jest)
        if (def.island) {
          this._collideIsland(def.island);
        }

        // Kolizja z moverami
        (def.movers || []).forEach((m, i) => {
          const pos = this._moverPos(m, i);
          this._collideMover(pos, m);
        });

        // Sprawdź czy piłka wpadła do dołka
        if (!this._holeClear) {
          const hx = def.hole.rx * this.W;
          const hy = def.hole.ry * this.H;
          const dist = Math.hypot(this.ball.x - hx, this.ball.y - hy);
          const spd  = Math.hypot(this.ball.vx, this.ball.vy);
          if (dist < HOLE_R * 0.9 && spd < 0.003) {
            this._holeClear = true;
            this._holeClearTimer = 1400;
            this.ball.vx = 0; this.ball.vy = 0;
            this.totalStrokes += this.strokes;
            this._emitStats();
            break;
          }
          // Piłka wciągana do dołka przy małej prędkości i bliskości
          if (dist < HOLE_R * 1.5 && spd < 0.005) {
            const pull = 0.0012 * dt;
            const nx = (hx - this.ball.x) / (dist || 1);
            const ny = (hy - this.ball.y) / (dist || 1);
            this.ball.vx += nx * pull * 1000;
            this.ball.vy += ny * pull * 1000;
          }
        }
      }

      // Zatrzymanie piłki
      const spd = Math.hypot(this.ball.vx, this.ball.vy);
      if (spd < MIN_SPEED) {
        this.ball.vx = 0; this.ball.vy = 0;
        this.ballMoving = false;
        // Sprawdź czy limit uderzeń
        if (this.strokes >= 8 && !this._holeClear) {
          this._skipCountdown = true;
          this._skipTimer = 1200;
        }
      }
    }
  }

  _strike(speed) {
    if (this.ballMoving || this._holeClear) return;
    this.ball.vx = Math.cos(this.aimAngle) * speed * 1000;
    this.ball.vy = Math.sin(this.aimAngle) * speed * 1000;
    this.ballMoving = true;
    this.strokes++;
    this._hintTimer = 0;
    this._emitStats();
    if (this.strokes >= 8 && !this._holeClear) {
      this._skipCountdown = true;
      this._skipTimer = 3000;
    }
  }

  _nextHole() {
    if (this.holeIdx + 1 >= HOLES_DEF.length) {
      this.running = false;
      this.emit('end', { score: this.totalStrokes });
    } else {
      this._setupHole(this.holeIdx + 1);
      this._emitStats();
    }
  }

  // ─── Kolizje ──────────────────────────────────────────────────
  _bounceWalls() {
    const margin = BALL_R;
    if (this.ball.x < margin) {
      this.ball.x = margin;
      this.ball.vx = Math.abs(this.ball.vx) * ELASTICITY;
    }
    if (this.ball.x > this.W - margin) {
      this.ball.x = this.W - margin;
      this.ball.vx = -Math.abs(this.ball.vx) * ELASTICITY;
    }
    if (this.ball.y < margin) {
      this.ball.y = margin;
      this.ball.vy = Math.abs(this.ball.vy) * ELASTICITY;
    }
    if (this.ball.y > this.H - margin) {
      this.ball.y = this.H - margin;
      this.ball.vy = -Math.abs(this.ball.vy) * ELASTICITY;
    }
  }

  _collideLevelWalls() {
    const def = HOLES_DEF[this.holeIdx];
    (def.walls || []).forEach(w => {
      const x1 = w.rx1 * this.W, y1 = w.ry1 * this.H;
      const x2 = w.rx2 * this.W, y2 = w.ry2 * this.H;
      this._collideSeg(x1, y1, x2, y2);
    });
  }

  _collideSeg(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx*dx + dy*dy;
    if (len2 < 0.01) return;
    const t = clamp(((this.ball.x-x1)*dx + (this.ball.y-y1)*dy) / len2, 0, 1);
    const cx = x1 + t*dx, cy = y1 + t*dy;
    const ex = this.ball.x - cx, ey = this.ball.y - cy;
    const dist = Math.hypot(ex, ey);
    if (dist < BALL_R + 3 && dist > 0.01) {
      const nx = ex/dist, ny = ey/dist;
      this.ball.x = cx + nx * (BALL_R + 4);
      this.ball.y = cy + ny * (BALL_R + 4);
      const dot = this.ball.vx*nx + this.ball.vy*ny;
      if (dot < 0) {
        this.ball.vx -= (1 + ELASTICITY) * dot * nx;
        this.ball.vy -= (1 + ELASTICITY) * dot * ny;
      }
    }
  }

  _collideIsland(island) {
    const ix = island.rx * this.W;
    const iy = island.ry * this.H;
    const ir = island.rr * Math.min(this.W, this.H);
    const dx = this.ball.x - ix;
    const dy = this.ball.y - iy;
    const dist = Math.hypot(dx, dy);
    const minDist = BALL_R + ir;
    if (dist < minDist && dist > 0.01) {
      const nx = dx/dist, ny = dy/dist;
      this.ball.x = ix + nx * (minDist + 1);
      this.ball.y = iy + ny * (minDist + 1);
      const dot = this.ball.vx*nx + this.ball.vy*ny;
      if (dot < 0) {
        this.ball.vx -= (1 + ELASTICITY) * dot * nx;
        this.ball.vy -= (1 + ELASTICITY) * dot * ny;
      }
    }
  }

  _moverPos(m, i) {
    const phase = this._moverPhase[i] || 0;
    const offset = Math.sin(phase) * m.range;
    let cx = m.rcx * this.W, cy = m.rcy * this.H;
    if (m.axis === 'x') cx += offset * this.W;
    else cy += offset * this.H;
    return {
      cx, cy,
      w: m.rw * this.W,
      h: m.rh * this.H,
    };
  }

  _collideMover(pos, m) {
    // Prostokąt jako 4 odcinki
    const { cx, cy, w, h } = pos;
    const x1 = cx - w/2, y1 = cy - h/2;
    const x2 = cx + w/2, y2 = cy + h/2;
    // Sprawdź czy piłka jest blisko prostokąta
    const nearX = clamp(this.ball.x, x1, x2);
    const nearY = clamp(this.ball.y, y1, y2);
    const dx = this.ball.x - nearX;
    const dy = this.ball.y - nearY;
    const dist = Math.hypot(dx, dy);
    if (dist < BALL_R + 2 && dist > 0.01) {
      const nx = dx/dist, ny = dy/dist;
      this.ball.x = nearX + nx * (BALL_R + 3);
      this.ball.y = nearY + ny * (BALL_R + 3);
      const dot = this.ball.vx*nx + this.ball.vy*ny;
      if (dot < 0) {
        this.ball.vx -= (1 + ELASTICITY) * dot * nx;
        this.ball.vy -= (1 + ELASTICITY) * dot * ny;
      }
    } else if (dist === 0) {
      // Wewnątrz — wypchnij w górę
      this.ball.y = y1 - BALL_R - 1;
      this.ball.vy = -Math.abs(this.ball.vy) * ELASTICITY;
    }
  }

  onKeyDown(code) {
    if (code === 'ArrowLeft')  this._aimSpeed = -0.0030;
    if (code === 'ArrowRight') this._aimSpeed =  0.0030;
    if (code === 'Space' || code === 'ArrowUp') {
      if (!this.ballMoving) this._strike(0.005);
    }
  }
  onKeyUp(code) {
    if (code === 'ArrowLeft' || code === 'ArrowRight') this._aimSpeed = 0;
  }

  // ─── draw ─────────────────────────────────────────────────────
  draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    // Tło — ciemnozielona trawa
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#052e16');
    bg.addColorStop(1, '#14532d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Subtelna faktura trawy (siatka)
    ctx.save();
    ctx.strokeStyle = 'rgba(21,128,61,0.18)';
    ctx.lineWidth = 1;
    const gs = Math.round(W / 14);
    for (let x = 0; x < W; x += gs) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y = 0; y < H; y += gs) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
    ctx.restore();

    const def = HOLES_DEF[this.holeIdx];

    // Ściany dołka
    this._drawWalls(def);

    // Wyspa
    if (def.island) this._drawIsland(def.island);

    // Moverzy
    (def.movers || []).forEach((m, i) => {
      const pos = this._moverPos(m, i);
      this._drawMover(pos);
    });

    // Tee (punkt startowy)
    this._drawTee(def.tee.rx * W, def.tee.ry * H);

    // Dołek (hole)
    this._drawHole(def.hole.rx * W, def.hole.ry * H);

    // Piłka + strzałka celowania
    if (!this._holeClear) {
      if (!this.ballMoving) {
        this._drawAimArrow();
      }
      this._drawBall();
    } else {
      // Animacja wpadnięcia
      const hx = def.hole.rx * W;
      const hy = def.hole.ry * H;
      const progress = 1 - this._holeClearTimer / 1400;
      const scale = Math.max(0, 1 - progress * 1.1);
      ctx.save();
      ctx.globalAlpha = scale;
      ctx.translate(hx + (this.ball.x - hx) * (1 - progress), hy + (this.ball.y - hy) * (1 - progress));
      ctx.scale(scale, scale);
      this._drawBallAt(0, 0);
      ctx.restore();

      // "Hole in X!" text
      if (progress > 0.3) {
        ctx.save();
        const parDiff = this.strokes - def.par;
        let msg, col;
        if (this.strokes === 1)      { msg = 'Hole in One!'; col = '#facc15'; }
        else if (parDiff <= -2)      { msg = 'Eagle!';       col = '#facc15'; }
        else if (parDiff === -1)     { msg = 'Birdie!';      col = '#4ade80'; }
        else if (parDiff === 0)      { msg = 'Par!';         col = '#86efac'; }
        else if (parDiff === 1)      { msg = 'Bogey';        col = '#fbbf24'; }
        else                         { msg = `+${parDiff}`; col = '#f87171'; }
        ctx.fillStyle = col;
        ctx.font = `900 ${Math.round(W/7)}px Outfit,sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.shadowColor = col; ctx.shadowBlur = 28;
        ctx.globalAlpha = Math.min(1, (progress - 0.3) * 3);
        ctx.fillText(msg, W/2, H/2);
        ctx.restore();
      }
    }

    // Skip countdown
    if (this._skipCountdown && !this._holeClear) {
      ctx.save();
      ctx.fillStyle = '#f87171';
      ctx.font = `700 ${Math.round(W/16)}px Outfit,sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.globalAlpha = 0.85;
      ctx.fillText(`Automatyczny skip za ${Math.ceil(this._skipTimer / 1000)}s`, W/2, H - 36);
      ctx.restore();
    }

    // HUD
    this._drawHUD(def);

    // Hint na początku
    if (this._hintTimer > 0 && !this.ballMoving) {
      const alpha = Math.min(1, this._hintTimer / 800);
      ctx.save();
      ctx.globalAlpha = alpha;
      if (this.triki.connected) {
        drawHintBubble(ctx, W/2, H * 0.55, 'Przechyl = kąt · Potrząśnij = uderz', { fontSize: 12 });
      } else {
        drawHintBubble(ctx, W/2, H * 0.55, '← → = kąt · Spacja = uderz', { fontSize: 12 });
      }
      ctx.restore();
    }
  }

  _drawWalls(def) {
    const { ctx, W, H } = this;
    ctx.save();
    ctx.strokeStyle = '#15803d';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.shadowColor = '#166534'; ctx.shadowBlur = 4;
    (def.walls || []).forEach(w => {
      const x1 = w.rx1*W, y1 = w.ry1*H, x2 = w.rx2*W, y2 = w.ry2*H;
      // Wypełniona ściana (bunkier — piasek)
      const len = Math.hypot(x2-x1, y2-y1);
      if (len < 1) return;
      const nx = -(y2-y1)/len * 5, ny = (x2-x1)/len * 5;
      ctx.fillStyle = '#78350f';
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(x1+nx, y1+ny); ctx.lineTo(x2+nx, y2+ny);
      ctx.lineTo(x2-nx, y2-ny); ctx.lineTo(x1-nx, y1-ny);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#92400e';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
    ctx.restore();
  }

  _drawIsland(island) {
    const { ctx, W, H } = this;
    const ix = island.rx * W;
    const iy = island.ry * H;
    const ir = island.rr * Math.min(W, H);
    ctx.save();
    ctx.fillStyle = '#78350f';
    ctx.strokeStyle = '#92400e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(ix, iy, ir, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    // Trawa na wyspie
    ctx.fillStyle = '#15803d';
    ctx.beginPath();
    ctx.arc(ix, iy, ir * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawMover(pos) {
    const { ctx } = this;
    const { cx, cy, w, h } = pos;
    ctx.save();
    ctx.fillStyle = '#78350f';
    ctx.strokeStyle = '#a16207';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#92400e'; ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.roundRect(cx - w/2, cy - h/2, w, h, 4);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  _drawTee(x, y) {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = '#fbbf24';
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#fbbf24'; ctx.shadowBlur = 8;
    // Krzyżyk tee
    const s = 8;
    ctx.beginPath();
    ctx.moveTo(x-s, y); ctx.lineTo(x+s, y);
    ctx.moveTo(x, y-s); ctx.lineTo(x, y+s);
    ctx.stroke();
    ctx.restore();
  }

  _drawHole(x, y) {
    const { ctx } = this;
    // Czarna dziura
    ctx.save();
    ctx.fillStyle = '#000000';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(x, y, HOLE_R, 0, Math.PI * 2);
    ctx.fill();
    // Obramowanie (biała kreska)
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 0;
    ctx.stroke();
    // Chorągiewka
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#ef4444'; ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(x, y - HOLE_R);
    ctx.lineTo(x, y - HOLE_R - 22);
    ctx.stroke();
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(x, y - HOLE_R - 22);
    ctx.lineTo(x + 14, y - HOLE_R - 16);
    ctx.lineTo(x, y - HOLE_R - 10);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  _drawAimArrow() {
    const { ctx, ball, aimAngle, W, H } = this;
    const len  = Math.min(W, H) * 0.22;
    const ex   = ball.x + Math.cos(aimAngle) * len;
    const ey   = ball.y + Math.sin(aimAngle) * len;
    const pulse = 0.7 + 0.3 * Math.abs(Math.sin(performance.now() * 0.004));

    ctx.save();
    ctx.strokeStyle = `rgba(134,239,172,${pulse * 0.9})`;
    ctx.lineWidth   = 3;
    ctx.lineCap     = 'round';
    ctx.setLineDash([8, 6]);
    ctx.shadowColor = '#4ade80'; ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(ball.x, ball.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);
    // Grot strzałki
    const headLen = 14;
    const angle1  = aimAngle + Math.PI * 0.82;
    const angle2  = aimAngle - Math.PI * 0.82;
    ctx.fillStyle = `rgba(134,239,172,${pulse})`;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex + Math.cos(angle1)*headLen, ey + Math.sin(angle1)*headLen);
    ctx.lineTo(ex + Math.cos(angle2)*headLen, ey + Math.sin(angle2)*headLen);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  _drawBall() {
    const { ball } = this;
    this._drawBallAt(ball.x, ball.y);
  }

  _drawBallAt(x, y) {
    const { ctx } = this;
    radialGlow(ctx, x, y, BALL_R * 2.5, '#ffffff', 0.3);
    const g = ctx.createRadialGradient(x - BALL_R*0.3, y - BALL_R*0.35, 0.5, x, y, BALL_R);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.45, '#e5e7eb');
    g.addColorStop(1, '#9ca3af');
    ctx.save();
    ctx.fillStyle = g;
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawHUD(def) {
    const { ctx, W, H } = this;
    const par = def.par;
    const parDiff = this.strokes - par;
    const parCol = parDiff < 0 ? '#4ade80' : parDiff > 0 ? '#f87171' : '#86efac';

    // Belka górna
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, 38);
    ctx.restore();

    ctx.save();
    ctx.font = `700 ${Math.round(W/18)}px Outfit,sans-serif`;
    ctx.textBaseline = 'middle';
    // Numer dołka
    ctx.fillStyle = '#86efac';
    ctx.textAlign = 'left';
    ctx.fillText(`Dołek ${this.holeIdx + 1}/5`, 10, 19);
    // Par
    ctx.fillStyle = '#6ee7b7';
    ctx.textAlign = 'center';
    ctx.fillText(`Par ${par}`, W/2, 19);
    // Uderzenia
    ctx.fillStyle = parDiff === 0 ? '#86efac' : parCol;
    ctx.textAlign = 'right';
    ctx.fillText(`${this.strokes} uderzeń`, W - 10, 19);
    ctx.restore();

    // Pasek dolny: łączna suma
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, H - 28, W, 28);
    ctx.fillStyle = '#d1fae5';
    ctx.font = `500 ${Math.round(W/20)}px Outfit,sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const displayTotal = this.totalStrokes + this.strokes;
    ctx.fillText(`Łącznie: ${displayTotal} uderzeń`, W/2, H - 14);
    ctx.restore();
  }

  _emitStats() {
    const def = HOLES_DEF[this.holeIdx];
    const displayTotal = this.totalStrokes + this.strokes;
    this.emit('stats',
      `⛳ Dołek <b>${this.holeIdx + 1}/5</b> &nbsp;·&nbsp; ` +
      `Par ${def.par} &nbsp;·&nbsp; ` +
      `<b>${this.strokes}</b> uderzeń &nbsp;·&nbsp; ` +
      `Łącznie: <b>${displayTotal}</b>`
    );
  }
}
