// games/snake/game.js — Wąż Triki
// Sterowanie kapslem (wszystkie tryby = względne od głowy węża):
//   Akcelerometr (tilt): stabilny kąt boczny → lewa/prawa ręka węża
//   Żyroskop (swing/rotate): szybkie gesty / obrót → skręt
//   Żyroskop pionowy: im bardziej przechylisz do przodu, tym szybciej
//   Przycisk: ⚡ TURBO — boost prędkości na 2.5 s

import { clamp, drawGrid, radialGlow } from '../../static/gameutils.js';

const BASE_STEP_MS     = 185;  // bazowy czas kroku [ms]
const MIN_STEP_MS      = 75;   // maksymalna prędkość
const APPLES_PER_LEVEL = 5;

// Progi dla poszczególnych trybów [trigger, release]
const THRESH = {
  tilt:   [7,   2.5],   // jednostki akcelerometru (~13° = trigger)
  swing:  [42,  16 ],   // deg/s żyroskopu bocznego
  rotate: [28,  12 ],   // deg/s żyroskopu Z (obrót)
};

export default class SnakeGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas  = canvas;
    this.ctx     = ctx;
    this.triki   = triki;
    this.emit    = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;
    this._mx = 0.5; this._my = 0.5;

    // stan domyślny — drawIdle() może być wywołane przed start()
    this.cols = 17; this.rows = 23;
    this.snake = [{x: 8, y: 11}];
    this.dir = {x: 1, y: 0};
    this.pendingDir  = null;
    this.apple       = {x: 12, y: 11};
    this.obstacles   = [];
    this.score       = 0;
    this._stepAcc    = 0;
    this._banner     = null;
    this._rotLatch   = false;
    this._boostTimer = 0;    // ms pozostałe boostu
    this._tiltSig    = 0;    // bieżący sygnał (do wskaźnika)
    this._fwdSig     = 0;    // sygnał przód/tył (do prędkości)
  }

  // ─── gettery ─────────────────────────────────────────────
  get level()  { return 1 + Math.floor(this.score / APPLES_PER_LEVEL); }

  get stepMs() {
    const base  = Math.max(MIN_STEP_MS + 20, BASE_STEP_MS - (this.level - 1) * 14);
    // Turbo (przycisk)
    const boost = this._boostTimer > 0 ? 45 : 0;
    // Prędkość od przechyłu do przodu (tylko tryb tilt, os pionowa)
    // fwdSig > 0 = przechył do przodu = szybciej; < 0 = do tyłu = wolniej
    const tilt  = (this.triki.connected && this._mode() === 'tilt')
      ? clamp(this._fwdSig * 3.5, -25, 40)
      : 0;
    return clamp(base - boost - tilt, MIN_STEP_MS, 250);
  }

  // ─── start / resize ──────────────────────────────────────
  start(player) {
    this.player = player;
    const cell = Math.max(22, Math.min(34, Math.floor(this.W / 15)));
    this.cols = clamp(Math.floor(this.W / cell), 13, 25);
    this.rows = clamp(Math.floor(this.H / cell), 13, 36);

    const cx = Math.floor(this.cols / 2), cy = Math.floor(this.rows / 2);
    this.snake      = [{x: cx, y: cy}, {x: cx-1, y: cy}, {x: cx-2, y: cy}];
    this.dir        = {x: 1, y: 0};
    this.pendingDir = null;
    this.obstacles  = [];
    this.score      = 0;
    this._stepAcc   = 0;
    this._banner    = {text: 'POZIOM 1', t: 1200};
    this._lastLevel = 1;
    this._rotLatch  = false;
    this._boostTimer= 0;
    this._tiltSig   = 0;
    this._fwdSig    = 0;
    this._spawnApple();
    this.running = true;
    this._emitStats();
  }

  resize(W, H) { this.W = W; this.H = H; }
  onMouseMove(nx, ny) { this._mx = nx; this._my = ny; }
  onClick() {}

  onKeyDown(code) {
    const dirs = {
      ArrowUp:{x:0,y:-1}, ArrowDown:{x:0,y:1},
      ArrowLeft:{x:-1,y:0}, ArrowRight:{x:1,y:0},
      KeyW:{x:0,y:-1}, KeyS:{x:0,y:1}, KeyA:{x:-1,y:0}, KeyD:{x:1,y:0},
    };
    if (dirs[code]) this._trySetDir(dirs[code]);
  }

  // ─── helpers ─────────────────────────────────────────────
  _mode() {
    return (typeof localStorage !== 'undefined'
      && localStorage.getItem('ctrlmode_snake')) || 'tilt';
  }

  _trySetDir(d) {
    if (d.x === -this.dir.x && d.y === -this.dir.y) return; // zakaz zawracania
    this.pendingDir = d;
  }

  // skręt WZGLĘDNY od głowy: s > 0 = CW (prawo), s < 0 = CCW (lewo)
  _turn(s) {
    const d = this.pendingDir || this.dir;
    this._trySetDir(s > 0 ? {x: -d.y, y: d.x} : {x: d.y, y: -d.x});
  }

  // ─── INPUT (serce nowych sterowania) ─────────────────────
  _inputDir() {
    if (!this.triki.connected) {
      // bez kapsla: absolutny kierunek w stronę kursora
      this._tiltSig = 0; this._fwdSig = 0;
      const head = this.snake[0];
      const cw = this.W / this.cols, ch = this.H / this.rows;
      const dx = this._mx * this.W - (head.x + 0.5) * cw;
      const dy = this._my * this.H - (head.y + 0.5) * ch;
      if (Math.hypot(dx, dy) < cw * 0.8) return;
      if (Math.abs(dx) > Math.abs(dy)) this._trySetDir({x: dx>0?1:-1, y:0});
      else                             this._trySetDir({x:0, y: dy>0?1:-1});
      return;
    }

    const mode = this._mode();

    // ── oblicz sygnał skrętu (boczny) ────────────────────
    let sig;
    if (mode === 'rotate') {
      // obrót kapslem = czysty żyroskop Z
      sig = this.triki.ROT(0);

    } else if (mode === 'swing') {
      // machanie: czysty żyroskop boczny (bez skalowania czułości — raw deg/s)
      sig = -this.triki.gz;

    } else {
      // TILT — główny tryb.
      // Akcelerometr boczny (stabilny, bez dryfu) + mały assist żyroskopu
      // żeby wyczuć szybki gest zanim kapsel osiągnie duży kąt.
      //
      // -GZ() = kalibrowany sygnał boczny (lewo/prawo) w jednostkach gry
      // -gz   = surowy żyroskop boczny [deg/s], waga 0.06
      const accelH = -this.triki.GZ(0);   // kalibrowany kąt boczny
      const gyroH  = -this.triki.gz;      // prędkość kątowa boczna [deg/s]
      sig = accelH + gyroH * 0.06;        // gyro lekko przyspiesza reakcję

      // ── sygnał przód/tył → prędkość węża (tylko tryb tilt) ───
      // GX(0) = kalibrowana oś pionowa gry = przechył kapsla do przodu/tyłu
      // Pozytywny GX = przód = szybciej; negatywny = wolniej
      this._fwdSig = this.triki.GX(0);
    }

    this._tiltSig = sig;

    // ── latch: jeden skręt na jedno wychylenie ───────────
    const [trigger, release] = THRESH[mode] || THRESH.tilt;

    if (Math.abs(sig) >= trigger) {
      if (!this._rotLatch) {
        this._rotLatch = true;
        this._turn(sig > 0 ? 1 : -1);
      }
    } else if (Math.abs(sig) < release) {
      this._rotLatch = false;   // wróciłeś do centrum — możesz skręcić ponownie
    }
  }

  // ─── update ──────────────────────────────────────────────
  update(dt) {
    if (!this.running) return;

    if (this._banner) { this._banner.t -= dt; if (this._banner.t <= 0) this._banner = null; }
    if (this._boostTimer > 0) this._boostTimer = Math.max(0, this._boostTimer - dt);

    // Przycisk = TURBO (boost na 2.5 sekundy)
    if (this.triki.consumeClick()) {
      this._boostTimer = 2500;
      this._banner = {text: '⚡ TURBO!', t: 1000, color: '#eab308'};
    }

    this._inputDir();

    this._stepAcc += dt;
    while (this._stepAcc >= this.stepMs) {
      this._stepAcc -= this.stepMs;
      this._step();
      if (!this.running) return;
    }
  }

  _step() {
    if (this.pendingDir) { this.dir = this.pendingDir; this.pendingDir = null; }
    const head = this.snake[0];
    const nx = head.x + this.dir.x;
    const ny = head.y + this.dir.y;

    const hitWall = nx < 0 || nx >= this.cols || ny < 0 || ny >= this.rows;
    const hitSelf = this.snake.some((s, i) => i < this.snake.length - 1 && s.x === nx && s.y === ny);
    const hitRock = this.obstacles.some(o => o.x === nx && o.y === ny);

    if (hitWall || hitSelf || hitRock) {
      this.running = false;
      this.emit('end', {score: this.score});
      return;
    }

    this.snake.unshift({x: nx, y: ny});
    if (nx === this.apple.x && ny === this.apple.y) {
      this.score++;
      const lvl = this.level;
      if (lvl > this._lastLevel) {
        this._lastLevel = lvl;
        this._banner = {text: `POZIOM ${lvl}!`, t: 1200};
        if (lvl >= 3) this._addObstacles(3);
      }
      this._spawnApple();
      this._emitStats();
    } else {
      this.snake.pop();
    }
  }

  // ─── draw ────────────────────────────────────────────────
  draw() {
    const {ctx, W, H} = this;
    ctx.clearRect(0, 0, W, H);
    drawGrid(ctx, W, H, 0.025);

    const cw = W / this.cols, ch = H / this.rows;
    const pad = Math.min(cw, ch) * 0.08;

    // kamienie
    this.obstacles.forEach(o => {
      ctx.save();
      ctx.fillStyle = '#475569';
      ctx.beginPath();
      ctx.roundRect(o.x*cw+pad, o.y*ch+pad, cw-2*pad, ch-2*pad, 6);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.font = `${Math.min(cw,ch)*.6}px Outfit,sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🪨', (o.x+.5)*cw, (o.y+.5)*ch);
      ctx.restore();
    });

    // jabłko
    const ax = (this.apple.x+.5)*cw, ay = (this.apple.y+.5)*ch;
    radialGlow(ctx, ax, ay, Math.min(cw,ch)*1.1, '#ef4444', .4);
    ctx.font = `${Math.min(cw,ch)*.8}px Outfit,sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🍎', ax, ay);

    // wąż
    const n = this.snake.length;
    this.snake.forEach((s, i) => {
      const t = n > 1 ? i / (n - 1) : 0;
      ctx.save();
      if (i === 0) {
        ctx.fillStyle = '#16a34a';
        ctx.shadowColor = '#22c55e'; ctx.shadowBlur = 14;
      } else {
        const g = Math.round(197 - t * 90);
        ctx.fillStyle = `rgb(34,${g},94)`;
      }
      ctx.beginPath();
      ctx.roundRect(s.x*cw+pad, s.y*ch+pad, cw-2*pad, ch-2*pad, Math.min(cw,ch)*.3);
      ctx.fill();
      ctx.restore();

      if (i === 0) {
        // oczy
        const exo = this.dir.x*cw*.16, eyo = this.dir.y*ch*.16;
        const perp = {x: -this.dir.y, y: this.dir.x};
        ctx.fillStyle = '#fff';
        [-1, 1].forEach(sgn => {
          ctx.beginPath();
          ctx.arc((s.x+.5)*cw + exo + sgn*perp.x*cw*.18,
                  (s.y+.5)*ch + eyo + sgn*perp.y*ch*.18,
                  Math.min(cw,ch)*.09, 0, Math.PI*2);
          ctx.fill();
        });

        // strzałka kierunku głowy (mała, przezroczysta)
        const ar = Math.min(cw, ch) * 0.22;
        ctx.save();
        ctx.translate((s.x+.5)*cw, (s.y+.5)*ch);
        ctx.rotate(Math.atan2(this.dir.y, this.dir.x));
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.moveTo(ar * 1.6, 0);
        ctx.lineTo(-ar * 0.5, -ar * 0.55);
        ctx.lineTo(-ar * 0.5,  ar * 0.55);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    });

    // banner (poziom / TURBO)
    if (this._banner) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this._banner.t / 350);
      ctx.fillStyle   = this._banner.color || '#22c55e';
      ctx.font = `800 ${Math.round(W/9)}px Outfit,sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 24;
      ctx.fillText(this._banner.text, W/2, H/2.4);
      ctx.restore();
    }

    // turbo pasek na dole (czas pozostały)
    if (this._boostTimer > 0) {
      const frac = this._boostTimer / 2500;
      ctx.save();
      ctx.fillStyle = '#eab308';
      ctx.shadowColor = '#eab308'; ctx.shadowBlur = 8;
      ctx.fillRect(0, H - 4, W * frac, 4);
      ctx.restore();
    }

    // wskaźnik przechyłu kapsla (tylko przy podłączonym)
    if (this.triki.connected) {
      this._drawTiltBar();
    }
  }

  // ─── wskaźnik bocznego przechyłu ─────────────────────────
  _drawTiltBar() {
    const {ctx, W, H} = this;
    const mode = this._mode();
    const [trigger] = THRESH[mode] || THRESH.tilt;
    const maxSig = trigger * 1.6;

    const BW = Math.min(160, W * 0.48);
    const BH = 5;
    const bx = W/2 - BW/2;
    const by = H - 22;

    ctx.save();

    // track
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(bx, by, BW, BH, 3);
    ctx.fill();

    // strefa trigger (lewa i prawa)
    const zoneW = BW * (1 - 1/1.6) / 2;
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = '#22c55e';
    ctx.beginPath(); ctx.roundRect(bx, by, zoneW, BH, 3); ctx.fill();
    ctx.beginPath(); ctx.roundRect(bx+BW-zoneW, by, zoneW, BH, 3); ctx.fill();

    // kreska środka
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(W/2 - 1, by - 2, 2, BH + 4);

    // kropka sygnału
    const norm  = clamp(this._tiltSig / maxSig, -1, 1);
    const dotX  = W/2 + norm * BW/2;
    const turned = this._rotLatch;
    const color = turned ? '#22c55e'
                : (Math.abs(norm) > 0.62 ? '#eab308' : 'rgba(255,255,255,.75)');

    ctx.globalAlpha = 0.95;
    ctx.fillStyle   = color;
    ctx.shadowColor = color; ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(dotX, by + BH/2, 7, 0, Math.PI*2);
    ctx.fill();

    // etykieta "← →" przy pasku
    ctx.globalAlpha = 0.22;
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = '#ffffff';
    ctx.font        = '10px Outfit,sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign   = 'right'; ctx.fillText('◀', bx - 4, by + BH/2);
    ctx.textAlign   = 'left';  ctx.fillText('▶', bx + BW + 4, by + BH/2);

    // prędkość od przechyłu do przodu (tylko tilt)
    if (mode === 'tilt' && Math.abs(this._fwdSig) > 1) {
      const spd = clamp(this._fwdSig / 12, -1, 1);
      const sColor = spd > 0 ? '#22c55e' : '#ef4444';
      ctx.globalAlpha = 0.5;
      ctx.fillStyle   = sColor;
      ctx.font        = '9px Outfit,sans-serif';
      ctx.textAlign   = 'center';
      ctx.fillText(spd > 0 ? '⚡ szybciej' : '⬇ wolniej', W/2, by - 8);
    }

    ctx.restore();
  }

  drawIdle() { this.draw(); }
  destroy()  { this.running = false; }

  // ─── spawning / scoring ───────────────────────────────────
  _freeCell(minDist = 3) {
    const head = this.snake[0];
    for (let t = 0; t < 200; t++) {
      const x = Math.floor(Math.random() * this.cols);
      const y = Math.floor(Math.random() * this.rows);
      if (Math.abs(x-head.x)+Math.abs(y-head.y) < minDist) continue;
      if (this.snake.some(s => s.x===x && s.y===y)) continue;
      if (this.obstacles.some(o => o.x===x && o.y===y)) continue;
      if (this.apple && this.apple.x===x && this.apple.y===y) continue;
      return {x, y};
    }
    return null;
  }

  _spawnApple()   { const c = this._freeCell(2); if (c) this.apple = c; }
  _addObstacles(n) { for (let i=0;i<n;i++) { const c=this._freeCell(5); if(c) this.obstacles.push(c); } }

  _emitStats() {
    this.emit('stats',
      `⭐ Poz. <b>${this.level}</b> &nbsp;·&nbsp; 🍎 <b>${this.score}</b> &nbsp;·&nbsp; 🐍 ${this.snake.length}`
      + (this._boostTimer > 0 ? ' &nbsp;·&nbsp; <span style="color:#eab308">⚡ TURBO</span>' : ''));
  }
}
