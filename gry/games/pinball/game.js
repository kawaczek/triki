// games/pinball/game.js — Pinball Triki
// Sterowanie: przechyl kapsla w lewo (GZ < -15) = lewy flipper
//             przechyl kapsla w prawo (GZ > 15) = prawy flipper
//             Guzik = wystrzał piłki z launchera
// Fizyka: grawitacja, odbicia od ścian i flipperów, bumper = +50 pkt

import { clamp, radialGlow } from '../../static/gameutils.js';

const GRAVITY      = 0.0006;   // px/ms²
const BALL_R       = 9;
const BUMPER_R     = 25;
const ELASTICITY   = 0.62;
const FLIPPER_LEN  = 0;        // computed in resize
const FLIPPER_THICKNESS = 8;
const LAUNCH_SPEED = 0.95;     // px/ms

// Threshold aktywacji flipperów
const FLIP_THRESH  = 15;       // jednostki GZ

export default class PinballGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas  = canvas;
    this.ctx     = ctx;
    this.triki   = triki;
    this.emit    = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;

    // Stan gry — inicjalizowany tu dla drawIdle()
    this.score    = 0;
    this.lives    = 3;
    this._bumperFlash = [0, 0, 0];   // ms pozostałe efektu flash
    this._allBumpersHit = [false, false, false];
    this._bonusActive = false;
    this._bonusTimer  = 0;

    // Piłka
    this.ball = { x: 0, y: 0, vx: 0, vy: 0, active: false };
    this._inLauncher = true;
    this._launchCharge = 0;   // ms trzymania przycisku (unused now — single press)

    // Flippery
    this._leftFlipAngle  = Math.PI / 6;   // kąt spoczynku (30° w dół)
    this._rightFlipAngle = Math.PI - Math.PI / 6;
    this._leftActive  = false;
    this._rightActive = false;
    this._leftAngVel  = 0;
    this._rightAngVel = 0;

    this._computeLayout();
  }

  _computeLayout() {
    const W = this.W, H = this.H;

    // Pivoty flipperów
    this._lPivot = { x: W * 0.28, y: H * 0.88 };
    this._rPivot = { x: W * 0.72, y: H * 0.88 };
    this._flipLen = W * 0.35;

    // Bumpers — trójkąt
    this._bumpers = [
      { x: W * 0.5,  y: H * 0.26, r: BUMPER_R },
      { x: W * 0.28, y: H * 0.42, r: BUMPER_R },
      { x: W * 0.72, y: H * 0.42, r: BUMPER_R },
    ];

    // Lane guards (małe bloki przy flipperach)
    this._laneGuards = [
      { x1: W * 0.08, y1: H * 0.82, x2: W * 0.16, y2: H * 0.86 },
      { x1: W * 0.84, y1: H * 0.82, x2: W * 0.92, y2: H * 0.86 },
    ];

    // Launcher po prawej stronie
    this._launcherX = W * 0.92;
    this._launcherTopY = H * 0.7;
    this._launcherBottomY = H * 0.95;

    // Pozycja startowa piłki w launcherze
    if (this._inLauncher) {
      this.ball.x = this._launcherX;
      this.ball.y = this._launcherBottomY - BALL_R - 2;
      this.ball.vx = 0;
      this.ball.vy = 0;
    }
  }

  start(player) {
    this.player   = player;
    this.W = this.canvas.width;
    this.H = this.canvas.height;
    this.score    = 0;
    this.lives    = 3;
    this._bumperFlash = [0, 0, 0];
    this._allBumpersHit = [false, false, false];
    this._bonusActive = false;
    this._bonusTimer  = 0;
    this._inLauncher  = true;
    this._launchCharge = 0;
    this._leftActive  = false;
    this._rightActive = false;
    this._leftAngVel  = 0;
    this._rightAngVel = 0;
    this._leftFlipAngle  = Math.PI / 6;
    this._rightFlipAngle = Math.PI - Math.PI / 6;
    this._computeLayout();
    this.ball = {
      x: this._launcherX,
      y: this._launcherBottomY - BALL_R - 2,
      vx: 0, vy: 0, active: false
    };
    this.running = true;
    this._emitStats();
  }

  resize(W, H) {
    this.W = W; this.H = H;
    this._computeLayout();
  }

  destroy() { this.running = false; }
  drawIdle() { this.draw(); }

  // ─── update ──────────────────────────────────────────────────
  update(dt) {
    if (!this.running) return;

    // Flippery — odczyt GZ
    const gz = this.triki.connected ? -this.triki.GZ(0) : 0;
    const wantLeft  = gz < -FLIP_THRESH;
    const wantRight = gz >  FLIP_THRESH;

    // Animacja flipperów
    this._animateFlipper(dt, wantLeft, wantRight);

    // Przycisk — wystrzał piłki
    if (this.triki.consumeClick() || (!this.triki.connected && this._autoLaunch)) {
      this._autoLaunch = false;
      if (this._inLauncher) {
        this._launch();
      }
    }

    // Bez BLE — auto-klawiszatura obsługiwana przez onKeyDown
    // Bez BLE i bez kliknięcia — dajmy autolaunch po krótkim czasie
    if (!this.triki.connected && this._inLauncher) {
      this._launchTimer = (this._launchTimer || 0) + dt;
      if (this._launchTimer > 1800) {
        this._launchTimer = 0;
        this._launch();
      }
    } else if (!this._inLauncher) {
      this._launchTimer = 0;
    }

    // Bumper flash timer
    this._bumperFlash = this._bumperFlash.map(t => Math.max(0, t - dt));
    if (this._bonusTimer > 0) {
      this._bonusTimer = Math.max(0, this._bonusTimer - dt);
      if (this._bonusTimer <= 0) this._bonusActive = false;
    }

    if (!this.ball.active) return;

    // Fizyka piłki
    this.ball.vy += GRAVITY * dt;
    this.ball.x  += this.ball.vx * dt;
    this.ball.y  += this.ball.vy * dt;

    // Ściany boczne
    const wallL = BALL_R + 2;
    const wallR = this.W * 0.88 - BALL_R;   // prawa ściana (launcher jest za nią)
    if (this.ball.x < wallL) {
      this.ball.x  = wallL;
      this.ball.vx = Math.abs(this.ball.vx) * ELASTICITY;
    }
    if (this.ball.x > wallR) {
      this.ball.x  = wallR;
      this.ball.vx = -Math.abs(this.ball.vx) * ELASTICITY;
    }
    // Sufit
    if (this.ball.y < BALL_R + 2) {
      this.ball.y  = BALL_R + 2;
      this.ball.vy = Math.abs(this.ball.vy) * ELASTICITY;
    }

    // Kolizja z bumperami
    this._bumpers.forEach((b, i) => {
      const dx = this.ball.x - b.x;
      const dy = this.ball.y - b.y;
      const dist = Math.hypot(dx, dy);
      if (dist < BALL_R + b.r) {
        // Odbij
        const nx = dx / dist, ny = dy / dist;
        const spd = Math.hypot(this.ball.vx, this.ball.vy);
        const bouncedSpd = Math.max(spd * 1.1, 0.6); // bumper przyspiesza
        this.ball.vx = nx * bouncedSpd;
        this.ball.vy = ny * bouncedSpd;
        // Wypchnij poza kolizję
        const overlap = BALL_R + b.r - dist + 1;
        this.ball.x += nx * overlap;
        this.ball.y += ny * overlap;
        // Punkty
        this._bumperFlash[i] = 350;
        const pts = this._bonusActive ? 100 : 50;
        this.score += pts;
        // Sprawdź combo
        this._allBumpersHit[i] = true;
        if (this._allBumpersHit.every(v => v)) {
          this._allBumpersHit = [false, false, false];
          this._bonusActive = true;
          this._bonusTimer  = 5000;
          this._comboFlash  = 1200;
        }
        this._emitStats();
      }
    });

    // Kolizja z lane guards
    this._laneGuards.forEach(g => {
      this._collideSeg(g.x1, g.y1, g.x2, g.y2);
    });

    // Kolizja z flipperami
    this._collideFlipperLeft();
    this._collideFlipperRight();

    // Drenaż — piłka wpadła na dno
    if (this.ball.y > this.H + BALL_R * 2) {
      this._loseLife();
    }

    // Combo flash timer
    if (this._comboFlash > 0) this._comboFlash = Math.max(0, (this._comboFlash || 0) - dt);
  }

  _animateFlipper(dt, wantLeft, wantRight) {
    const REST_LEFT   =  Math.PI / 6;     //  30°
    const ACTIVE_LEFT = -Math.PI / 6;     // -30°
    const REST_RIGHT   = Math.PI - Math.PI / 6;
    const ACTIVE_RIGHT = Math.PI + Math.PI / 6;
    const SPEED = 0.018; // rad/ms

    if (wantLeft !== this._leftActive) {
      this._leftActive = wantLeft;
    }
    const targetLeft = this._leftActive ? ACTIVE_LEFT : REST_LEFT;
    this._leftFlipAngle  = _moveToward(this._leftFlipAngle, targetLeft, SPEED * dt);
    this._leftAngVel     = (targetLeft - this._leftFlipAngle) * 0.1;

    if (wantRight !== this._rightActive) {
      this._rightActive = wantRight;
    }
    const targetRight = this._rightActive ? ACTIVE_RIGHT : REST_RIGHT;
    this._rightFlipAngle = _moveToward(this._rightFlipAngle, targetRight, SPEED * dt);
    this._rightAngVel    = (targetRight - this._rightFlipAngle) * 0.1;
  }

  _launch() {
    this.ball.active = true;
    this._inLauncher = false;
    this.ball.vx = -LAUNCH_SPEED * 0.15;
    this.ball.vy = -LAUNCH_SPEED;
    this._launchTimer = 0;
  }

  _loseLife() {
    this.lives--;
    this.ball.active = false;
    this._inLauncher = true;
    this.ball.x = this._launcherX;
    this.ball.y = this._launcherBottomY - BALL_R - 2;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this._launchTimer = 0;
    if (this.lives <= 0) {
      this.running = false;
      this.emit('end', { score: this.score });
    } else {
      this._emitStats();
    }
  }

  // ─── Kolizja piłka ↔ odcinek ─────────────────────────────────
  _collideSeg(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx*dx + dy*dy;
    if (len2 < 1) return;
    const t = clamp(((this.ball.x-x1)*dx + (this.ball.y-y1)*dy) / len2, 0, 1);
    const cx = x1 + t*dx, cy = y1 + t*dy;
    const ex = this.ball.x - cx, ey = this.ball.y - cy;
    const dist = Math.hypot(ex, ey);
    if (dist < BALL_R && dist > 0.01) {
      const nx = ex/dist, ny = ey/dist;
      // Odsuń piłkę
      this.ball.x = cx + nx * (BALL_R + 1);
      this.ball.y = cy + ny * (BALL_R + 1);
      // Odbij
      const dot = this.ball.vx*nx + this.ball.vy*ny;
      this.ball.vx -= 2 * dot * nx * ELASTICITY;
      this.ball.vy -= 2 * dot * ny * ELASTICITY;
    }
  }

  _collideFlipperLeft() {
    const p = this._lPivot;
    const ang = this._leftFlipAngle;
    const ex = p.x + Math.cos(ang) * this._flipLen;
    const ey = p.y + Math.sin(ang) * this._flipLen;
    this._collideFlipperSeg(p.x, p.y, ex, ey, this._leftAngVel);
  }

  _collideFlipperRight() {
    const p = this._rPivot;
    const ang = this._rightFlipAngle;
    const ex = p.x + Math.cos(ang) * this._flipLen;
    const ey = p.y + Math.sin(ang) * this._flipLen;
    this._collideFlipperSeg(p.x, p.y, ex, ey, this._rightAngVel);
  }

  _collideFlipperSeg(x1, y1, x2, y2, angVel) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx*dx + dy*dy;
    if (len2 < 1) return;
    const t = clamp(((this.ball.x-x1)*dx + (this.ball.y-y1)*dy) / len2, 0, 1);
    const cx = x1 + t*dx, cy = y1 + t*dy;
    const ex = this.ball.x - cx, ey = this.ball.y - cy;
    const dist = Math.hypot(ex, ey);
    const thick = FLIPPER_THICKNESS + BALL_R;
    if (dist < thick && dist > 0.01) {
      const nx = ex/dist, ny = ey/dist;
      // Odsuń
      this.ball.x = cx + nx * (thick + 1);
      this.ball.y = cy + ny * (thick + 1);
      // Prędkość flippera w punkcie kontaktu (prostopadła do ramienia)
      const armLen = t * Math.sqrt(len2);
      const flipperVel = angVel * armLen;
      // Wektor prędkości flippera (prostopadły do ramienia)
      const fvx = -dy/Math.sqrt(len2) * flipperVel;
      const fvy =  dx/Math.sqrt(len2) * flipperVel;
      // Odbij względem normalnej + dodaj prędkość flippera
      const relVx = this.ball.vx - fvx;
      const relVy = this.ball.vy - fvy;
      const dot = relVx*nx + relVy*ny;
      if (dot < 0) {
        this.ball.vx -= (1 + ELASTICITY) * dot * nx;
        this.ball.vy -= (1 + ELASTICITY) * dot * ny;
        // Dodaj impuls od kąta flippera (przyspieszenie przy aktywnym flipperze)
        this.ball.vx += fvx * 0.6;
        this.ball.vy += fvy * 0.6;
      }
    }
  }

  onKeyDown(code) {
    if (code === 'Space' || code === 'ArrowUp') {
      if (this._inLauncher) this._launch();
    }
    if (code === 'ArrowLeft'  || code === 'KeyZ') this._leftActive  = true;
    if (code === 'ArrowRight' || code === 'KeyX') this._rightActive = true;
  }
  onKeyUp(code) {
    if (code === 'ArrowLeft'  || code === 'KeyZ') this._leftActive  = false;
    if (code === 'ArrowRight' || code === 'KeyX') this._rightActive = false;
  }

  // ─── draw ─────────────────────────────────────────────────────
  draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    // Tło — ciemne z subtelnym gradienentem
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0a0014');
    bg.addColorStop(1, '#1a0030');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Ściany boczne (neonowe linie)
    ctx.save();
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#7c3aed';
    ctx.shadowBlur = 8;
    // Lewa
    ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(2, H); ctx.stroke();
    // Prawa (granica gry)
    ctx.beginPath(); ctx.moveTo(W*0.88, 0); ctx.lineTo(W*0.88, H); ctx.stroke();
    // Sufit
    ctx.beginPath(); ctx.moveTo(2, 2); ctx.lineTo(W*0.88, 2); ctx.stroke();
    ctx.restore();

    // Lane guards
    ctx.save();
    ctx.strokeStyle = '#a78bfa';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.shadowColor = '#a78bfa'; ctx.shadowBlur = 6;
    this._laneGuards.forEach(g => {
      ctx.beginPath();
      ctx.moveTo(g.x1, g.y1);
      ctx.lineTo(g.x2, g.y2);
      ctx.stroke();
    });
    ctx.restore();

    // Launcher
    this._drawLauncher();

    // Bumpers
    this._bumpers.forEach((b, i) => this._drawBumper(b, i));

    // Flippery
    this._drawFlipper(this._lPivot, this._leftFlipAngle, this._leftActive);
    this._drawFlipper(this._rPivot, this._rightFlipAngle, this._rightActive);

    // Piłka
    if (this.ball.active || this._inLauncher) {
      this._drawBall();
    }

    // Combo flash
    if (this._comboFlash > 0) {
      ctx.save();
      ctx.globalAlpha = (this._comboFlash / 1200) * 0.35;
      ctx.fillStyle = '#facc15';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      ctx.save();
      ctx.fillStyle = '#facc15';
      ctx.font = `900 ${Math.round(W/6)}px Outfit,sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = Math.min(1, this._comboFlash / 400);
      ctx.shadowColor = '#facc15'; ctx.shadowBlur = 30;
      ctx.fillText('COMBO!', W*0.44, H*0.6);
      ctx.restore();
    }

    // HUD
    this._drawHUD();
  }

  _drawBumper(b, i) {
    const { ctx } = this;
    const lit = this._bumperFlash[i] > 0;
    const frac = lit ? this._bumperFlash[i] / 350 : 0;
    const baseCol = this._bonusActive ? '#facc15' : '#c084fc';
    const litCol  = '#ffffff';
    const col = lit ? _lerpColor(baseCol, litCol, frac) : baseCol;

    radialGlow(ctx, b.x, b.y, b.r * (lit ? 3.5 : 2.4), col, lit ? 0.7 : 0.35);
    ctx.save();
    ctx.fillStyle = lit ? col : '#2e1065';
    ctx.strokeStyle = col;
    ctx.lineWidth = lit ? 3 : 2;
    ctx.shadowColor = col;
    ctx.shadowBlur = lit ? 22 : 10;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Wewnętrzny okrąg
    ctx.fillStyle = lit ? 'rgba(255,255,255,0.9)' : col;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Punkty przy trafieniu
    if (lit && frac > 0.55) {
      ctx.save();
      ctx.fillStyle = '#facc15';
      ctx.font = `700 ${Math.round(b.r * 0.8)}px Outfit,sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = frac;
      ctx.fillText(this._bonusActive ? '+100' : '+50', b.x, b.y - b.r - 12);
      ctx.restore();
    }
  }

  _drawFlipper(pivot, angle, active) {
    const { ctx } = this;
    const col = active ? '#e879f9' : '#7c3aed';
    const ex  = pivot.x + Math.cos(angle) * this._flipLen;
    const ey  = pivot.y + Math.sin(angle) * this._flipLen;

    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth   = FLIPPER_THICKNESS * 2;
    ctx.lineCap     = 'round';
    ctx.shadowColor = col;
    ctx.shadowBlur  = active ? 18 : 8;
    ctx.beginPath();
    ctx.moveTo(pivot.x, pivot.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    // Pivot dot
    ctx.fillStyle   = col;
    ctx.shadowBlur  = 0;
    ctx.beginPath();
    ctx.arc(pivot.x, pivot.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawBall() {
    const { ctx } = this;
    const { x, y } = this.ball;
    // Srebrna kulka z gradientem
    radialGlow(ctx, x, y, BALL_R * 2.8, '#c4b5fd', 0.4);
    const g = ctx.createRadialGradient(x - BALL_R*0.3, y - BALL_R*0.3, 1, x, y, BALL_R);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.4, '#d1d5db');
    g.addColorStop(1, '#6b7280');
    ctx.save();
    ctx.fillStyle = g;
    ctx.shadowColor = '#c4b5fd';
    ctx.shadowBlur  = 14;
    ctx.beginPath();
    ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawLauncher() {
    const { ctx } = this;
    const x = this._launcherX;
    const y1 = this._launcherTopY;
    const y2 = this._launcherBottomY;

    ctx.save();
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth = 4;
    // Ściana launchera (po lewej stronie toru)
    ctx.beginPath(); ctx.moveTo(x - 14, y1); ctx.lineTo(x - 14, y2); ctx.stroke();
    // Strzałka w górę (wskazuje kierunek strzału)
    if (this._inLauncher) {
      ctx.strokeStyle = 'rgba(167,139,250,0.5)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.moveTo(x, this.ball.y - BALL_R - 4); ctx.lineTo(x, y1 + 10); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(167,139,250,0.7)';
      ctx.beginPath();
      ctx.moveTo(x, y1 + 2);
      ctx.lineTo(x - 5, y1 + 14);
      ctx.lineTo(x + 5, y1 + 14);
      ctx.closePath();
      ctx.fill();

      // Hint "Naciśnij guzik"
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = `500 ${Math.max(9, Math.round(this.W / 22))}px Outfit,sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('naciśnij', x, y2 - 28);
      ctx.fillText('guzik', x, y2 - 14);
    }
    ctx.restore();
  }

  _drawHUD() {
    const { ctx, W, H } = this;
    const col = this._bonusActive ? '#facc15' : '#e879f9';

    // Wynik
    ctx.save();
    ctx.fillStyle = col;
    ctx.font = `800 ${Math.round(W / 10)}px Outfit,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.shadowColor = col; ctx.shadowBlur = 12;
    ctx.fillText(this.score, W * 0.44, 8);
    ctx.restore();

    // Piłki (życia) jako ikony
    ctx.save();
    const ballSpacing = 18;
    const totalW = (this.lives - 1) * ballSpacing;
    const startX = W * 0.44 - totalW / 2;
    for (let i = 0; i < this.lives; i++) {
      const bx = startX + i * ballSpacing;
      const by = H * 0.93;
      const g = ctx.createRadialGradient(bx - 2, by - 2, 1, bx, by, 6);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#9ca3af');
      ctx.fillStyle = g;
      ctx.shadowColor = '#c4b5fd'; ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(bx, by, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Bonus x2 indicator
    if (this._bonusActive) {
      ctx.save();
      ctx.fillStyle = '#facc15';
      ctx.font = `700 ${Math.round(W / 14)}px Outfit,sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.shadowColor = '#facc15'; ctx.shadowBlur = 14;
      const bPct = this._bonusTimer / 5000;
      ctx.globalAlpha = 0.6 + 0.4 * Math.abs(Math.sin(performance.now() * 0.006));
      ctx.fillText('x2 BONUS', W * 0.44, Math.round(W / 10) + 14);
      ctx.restore();
      // Pasek bonusu
      ctx.save();
      ctx.fillStyle = 'rgba(250,204,21,0.18)';
      ctx.fillRect(2, H * 0.89, W * 0.84, 4);
      ctx.fillStyle = '#facc15';
      ctx.shadowColor = '#facc15'; ctx.shadowBlur = 6;
      ctx.fillRect(2, H * 0.89, W * 0.84 * bPct, 4);
      ctx.restore();
    }

    // Kontroler hint (bez BLE)
    if (!this.triki.connected) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.font = `400 ${Math.round(W/20)}px Outfit,sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('Z = lewy flipper · X = prawy · Spacja = strzał', W * 0.44, H - 2);
      ctx.restore();
    }
  }

  _emitStats() {
    this.emit('stats',
      `🎯 <b>${this.score}</b> pkt &nbsp;·&nbsp; ` +
      `🔵 <b>${this.lives}</b> ${this.lives === 1 ? 'piłka' : 'piłki'}` +
      (this._bonusActive ? ' &nbsp;·&nbsp; <span style="color:#facc15">x2 BONUS</span>' : '')
    );
  }
}

// ─── helpers ────────────────────────────────────────────────────
function _moveToward(current, target, maxDelta) {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

function _lerpColor(hex1, hex2, t) {
  const r1 = parseInt(hex1.slice(1,3),16), g1 = parseInt(hex1.slice(3,5),16), b1 = parseInt(hex1.slice(5,7),16);
  const r2 = parseInt(hex2.slice(1,3),16), g2 = parseInt(hex2.slice(3,5),16), b2 = parseInt(hex2.slice(5,7),16);
  const r = Math.round(r1 + (r2-r1)*t);
  const g = Math.round(g1 + (g2-g1)*t);
  const b = Math.round(b1 + (b2-b1)*t);
  return `rgb(${r},${g},${b})`;
}
