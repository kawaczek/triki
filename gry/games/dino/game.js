// games/dino/game.js — Dino Bieg
// Nieskończony runner w stylu Chrome Dino.
// Klik = skok, GX < -20 = kucanie, kaktusy + ptaki, dzień/noc po 1000m.

import { rand } from '../../static/gameutils.js';

const GROUND_Y   = 0.75;   // linia ziemi (znormalizowana)
const DINO_X     = 0.18;   // pozycja dino na osi X (stała)
const GRAVITY    = 0.0000050; // przyspieszenie w dół (frakcja H / ms²) → skok ~0.22H, czas w powietrzu ~600ms
const JUMP_VY    = -0.00150;  // prędkość skoku (frakcja H / ms)
const CROUCH_GX  = -20;    // próg GX dla kucania
const SPD_MIN    = 0.30;   // px/ms przy starcie
const SPD_MAX    = 0.80;   // px/ms max
const SPD_ACCEL  = 0.000035; // wzrost px/ms na ms
const NIGHT_DIST = 1000;   // dystans [m] do zmiany na noc
const BIRD_DIST  = 500;    // dystans [m] kiedy pojawiają się ptaki
const SCORE_SCALE = 0.1;   // frames → metry (1 frame = 16ms → ~60fps → 6m/s)

export default class DinoGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas  = canvas;
    this.ctx     = ctx;
    this.triki   = triki;
    this.emit    = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;

    // dino
    this.dinoY   = 0;      // znorm. odsunięcie od ziemi (0 = na ziemi)
    this.dinoVY  = 0;      // prędkość pionowa (znorm.)
    this.onGround = true;
    this.crouching = false;
    this._legFrame = 0;    // 0 lub 1 — animacja nóg
    this._legAcc   = 0;

    // gra
    this.score    = 0;     // metry
    this.speed    = SPD_MIN;
    this.obstacles= [];
    this.clouds   = [];
    this.stars    = [];
    this._spawnAcc = 0;
    this._spawnInterval = 1800; // ms
    this._gameOver = false;
    this._nightT   = 0;    // postęp przejścia dzień→noc [0..1]

    this._initClouds();
    this._initStars();
  }

  _initClouds() {
    this.clouds = [];
    for (let i = 0; i < 5; i++) {
      this.clouds.push({
        x: Math.random(),
        y: rand(0.08, 0.35),
        w: rand(0.10, 0.22),
        spd: rand(0.00003, 0.00006),
      });
    }
  }

  _initStars() {
    this.stars = [];
    for (let i = 0; i < 60; i++) {
      this.stars.push({
        x: Math.random(),
        y: rand(0.02, 0.65),
        r: rand(0.8, 2.2),
      });
    }
  }

  start(player) {
    this.player    = player;
    this.dinoY     = 0;
    this.dinoVY    = 0;
    this.onGround  = true;
    this.crouching = false;
    this.score     = 0;
    this.speed     = SPD_MIN;
    this.obstacles = [];
    this._spawnAcc = 0;
    this._spawnInterval = 1800;
    this._gameOver = false;
    this._nightT   = 0;
    this._legFrame = 0;
    this._legAcc   = 0;
    this.running   = true;
    this._emitStats();
  }

  resize(W, H) { this.W = W; this.H = H; }

  onMouseMove() {}
  onClick()    { this._jump(); }
  onKeyDown(code) {
    if (code === 'Space' || code === 'ArrowUp') this._jump();
  }

  _jump() {
    if (!this.running || !this.onGround) return;
    this.dinoVY   = JUMP_VY;
    this.onGround = false;
  }

  update(dt) {
    if (!this.running) return;

    // klik triki = skok
    if (this.triki.connected && this.triki.consumeClick()) this._jump();

    // kucanie: GX < próg (pochylenie do przodu)
    this.crouching = this.triki.connected
      ? (this.triki.GX() < CROUCH_GX)
      : false;

    // prędkość rośnie do max
    this.speed = Math.min(SPD_MAX, this.speed + SPD_ACCEL * dt);

    // dystans
    const prevScore = Math.floor(this.score);
    this.score += this.speed * dt * SCORE_SCALE;
    if (Math.floor(this.score) !== prevScore) this._emitStats();

    // dzień/noc
    const nightTarget = this.score >= NIGHT_DIST ? 1 : 0;
    this._nightT += (nightTarget - this._nightT) * 0.001 * dt;

    // grawitacja dino
    this.dinoVY += GRAVITY * dt;
    this.dinoY  += this.dinoVY * dt;
    if (this.dinoY >= 0) {
      this.dinoY    = 0;
      this.dinoVY   = 0;
      this.onGround = true;
    }

    // animacja nóg
    if (this.onGround && !this.crouching) {
      this._legAcc += dt;
      if (this._legAcc > 160) { this._legAcc -= 160; this._legFrame ^= 1; }
    }

    // chmury
    this.clouds.forEach(c => {
      c.x -= c.spd * dt;
      if (c.x + c.w < 0) { c.x = 1 + c.w * 0.5; c.y = rand(0.08, 0.35); }
    });

    // spawn przeszkód
    this._spawnAcc += dt;
    this._spawnInterval = Math.max(700, 1800 - this.score * 0.5);
    if (this._spawnAcc >= this._spawnInterval) {
      this._spawnAcc -= this._spawnInterval;
      this._spawnObstacle();
    }

    // ruch przeszkód
    this.obstacles.forEach(o => { o.x -= this.speed * dt / this.W; });
    this.obstacles = this.obstacles.filter(o => o.x + o.w > -0.05);

    // kolizja AABB — wszystko w jednostkach znormalizowanych
    // dinoY <= 0 oznacza: dino jest -dinoY powyżej ziemi (frakcja H)
    const dh = this.crouching ? 0.06 : 0.12; // wysokość hitboxu dino (znorm.)
    const dw = 0.055;
    const dx  = DINO_X - dw * 0.5;           // lewa krawędź hitboxu X
    // górna krawędź hitboxu Y (dinoY jest ujemny gdy w powietrzu, 0 na ziemi)
    const dinoTop = GROUND_Y + this.dinoY - dh; // dh od góry hitboxa do ziemi

    for (const o of this.obstacles) {
      // górna krawędź przeszkody (znorm.)
      const oy = o.fly ? o.flyY : (GROUND_Y - o.h);
      const overlapX = dx + dw > o.x && dx < o.x + o.w;
      const overlapY = dinoTop + dh > oy && dinoTop < oy + o.h;
      if (overlapX && overlapY) {
        this._die();
        return;
      }
    }
  }

  _spawnObstacle() {
    const birdsEnabled = this.score >= BIRD_DIST;
    const wantBird = birdsEnabled && Math.random() < 0.35;

    if (wantBird) {
      // ptak leci na wysokości ~połowy między ziemią a środkiem (nie da się ominąć bez kucania)
      this.obstacles.push({
        x: 1.05,
        w: 0.07,
        h: 0.055,
        fly: true,
        flyY: GROUND_Y - 0.16, // znorm. górna krawędź ptaka
        type: 'bird',
        wingPhase: 0,
      });
    } else {
      // kaktus — pojedynczy lub podwójny
      const double = Math.random() < 0.3;
      const w = double ? 0.08 : 0.05;
      const h = rand(0.10, 0.16);
      this.obstacles.push({
        x: 1.05,
        w,
        h,
        fly: false,
        type: 'cactus',
        double,
      });
    }
  }

  _die() {
    this.running   = false;
    this._gameOver = true;
    this.emit('end', { score: Math.floor(this.score) });
  }

  draw() {
    const { ctx, W, H } = this;
    const n = this._nightT;

    // interpoluj kolory nieba
    const skyDay   = [219, 234, 254]; // #dbeafe
    const skyNight = [15,  23,  42];  // #0f172a
    const skyR = Math.round(skyDay[0] + (skyNight[0] - skyDay[0]) * n);
    const skyG = Math.round(skyDay[1] + (skyNight[1] - skyDay[1]) * n);
    const skyB = Math.round(skyDay[2] + (skyNight[2] - skyDay[2]) * n);
    ctx.fillStyle = `rgb(${skyR},${skyG},${skyB})`;
    ctx.fillRect(0, 0, W, H);

    // gwiazdy (nocy)
    if (n > 0.05) {
      ctx.save();
      ctx.globalAlpha = n * 0.9;
      ctx.fillStyle = '#f8fafc';
      this.stars.forEach(s => {
        ctx.beginPath();
        ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }

    // słońce / księżyc
    const sunX = W * 0.88, sunY = H * 0.12;
    ctx.save();
    ctx.beginPath();
    ctx.arc(sunX, sunY, W * 0.045, 0, Math.PI * 2);
    if (n < 0.5) {
      ctx.fillStyle = '#fbbf24';
      ctx.shadowColor = '#fcd34d'; ctx.shadowBlur = 20;
    } else {
      ctx.fillStyle = '#e2e8f0';
      ctx.shadowColor = '#cbd5e1'; ctx.shadowBlur = 14;
      // księżycowa "szczerbina"
      ctx.fill();
      ctx.beginPath();
      ctx.arc(sunX + W * 0.025, sunY - H * 0.01, W * 0.033, 0, Math.PI * 2);
      const skyCol = `rgb(${skyR},${skyG},${skyB})`;
      ctx.fillStyle = skyCol;
    }
    ctx.fill();
    ctx.restore();

    // chmury
    const cloudAlpha = n < 0.5 ? 1 : (1 - n * 0.7);
    ctx.save();
    ctx.globalAlpha = cloudAlpha;
    this.clouds.forEach(c => {
      _drawCloud(ctx, c.x * W, c.y * H, c.w * W, n);
    });
    ctx.restore();

    // ziemia
    const groundY = GROUND_Y * H;
    const gGrad = ctx.createLinearGradient(0, groundY, 0, H);
    gGrad.addColorStop(0, n < 0.5 ? '#a3e635' : '#334155');
    gGrad.addColorStop(1, n < 0.5 ? '#65a30d' : '#1e293b');
    ctx.fillStyle = gGrad;
    ctx.fillRect(0, groundY, W, H - groundY);

    // linia ziemi
    ctx.save();
    ctx.strokeStyle = n < 0.5 ? '#65a30d' : '#475569';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(W, groundY);
    ctx.stroke();
    ctx.restore();

    // przeszkody
    this.obstacles.forEach(o => {
      if (o.type === 'cactus') {
        _drawCactus(ctx, o.x * W, groundY, o.w * W, o.h * H, o.double, n);
      } else if (o.type === 'bird') {
        o.wingPhase = (o.wingPhase || 0) + 0.018;
        _drawBird(ctx, o.x * W, o.flyY * H, o.w * W, o.wingPhase, n);
      }
    });

    // dino
    const dinoX = DINO_X * W;
    const dinoBaseY = groundY;
    const dinoOffY  = this.dinoY * H; // ujemne = w górę
    _drawDino(ctx, dinoX, dinoBaseY + dinoOffY, W, this.crouching, this._legFrame, n);
  }

  drawIdle() { this.draw(); }
  destroy()  { this.running = false; }

  _emitStats() {
    this.emit('stats', `🦕 <b>${Math.floor(this.score)}</b> m`);
  }
}

// ── draw helpers ──────────────────────────────────────────

function _drawDino(ctx, x, groundY, W, crouching, legFrame, night) {
  const sc = W / 400;
  const col = night > 0.5 ? '#86efac' : '#16a34a';
  const dark = night > 0.5 ? '#166534' : '#14532d';
  ctx.save();
  ctx.fillStyle = col;
  ctx.shadowColor = col;
  ctx.shadowBlur = 8;

  if (crouching) {
    // ciało kucające — niższe, szersze
    const bw = 44 * sc, bh = 22 * sc;
    ctx.fillRect(x - bw * 0.5, groundY - bh, bw, bh);
    // głowa wysunięta do przodu
    ctx.fillRect(x + bw * 0.18, groundY - bh - 14 * sc, 26 * sc, 18 * sc);
    // oko
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.arc(x + bw * 0.38 + 10 * sc, groundY - bh - 8 * sc, 3 * sc, 0, Math.PI * 2);
    ctx.fill();
    // nogi kucające (płaskie)
    ctx.fillStyle = col;
    ctx.fillRect(x - bw * 0.3, groundY - 7 * sc, 10 * sc, 7 * sc);
    ctx.fillRect(x + bw * 0.05, groundY - 7 * sc, 10 * sc, 7 * sc);
  } else {
    // tułów
    const bw = 28 * sc, bh = 32 * sc;
    const bx = x - bw * 0.4, by = groundY - bh - 14 * sc;
    ctx.fillRect(bx, by, bw, bh);
    // głowa
    ctx.fillRect(bx + bw * 0.6, by - 18 * sc, 24 * sc, 20 * sc);
    // oko
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.arc(bx + bw * 0.6 + 17 * sc, by - 11 * sc, 3.5 * sc, 0, Math.PI * 2);
    ctx.fill();
    // mały ząb
    ctx.fillStyle = '#fff';
    ctx.fillRect(bx + bw * 0.6 + 10 * sc, by + 2 * sc, 4 * sc, 3 * sc);
    // ogon
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(bx, by + bh * 0.6);
    ctx.lineTo(bx - 18 * sc, by + bh * 0.75);
    ctx.lineTo(bx, by + bh);
    ctx.fill();
    // nogi animowane
    const leg1x = bx + bw * 0.18, leg2x = bx + bw * 0.62;
    const legH1 = legFrame === 0 ? 18 * sc : 12 * sc;
    const legH2 = legFrame === 0 ? 12 * sc : 18 * sc;
    ctx.fillRect(leg1x, groundY - legH1, 9 * sc, legH1);
    ctx.fillRect(leg2x, groundY - legH2, 9 * sc, legH2);
    // stopy
    ctx.fillRect(leg1x - 2 * sc, groundY - 5 * sc, 14 * sc, 5 * sc);
    ctx.fillRect(leg2x - 2 * sc, groundY - 5 * sc, 14 * sc, 5 * sc);
  }
  ctx.restore();
}

function _drawCactus(ctx, x, groundY, w, h, double, night) {
  const col = night > 0.5 ? '#4ade80' : '#15803d';
  const dark = night > 0.5 ? '#166534' : '#14532d';
  ctx.save();
  ctx.fillStyle = col;
  ctx.shadowColor = col;
  ctx.shadowBlur = 4;

  const stemW = w * 0.3;
  // pień
  ctx.fillRect(x + w * 0.35, groundY - h, stemW, h);
  // lewe ramię
  ctx.fillRect(x, groundY - h * 0.65, w * 0.38, stemW);
  ctx.fillRect(x, groundY - h * 0.75, stemW, h * 0.25);
  // prawe ramię
  if (double) {
    ctx.fillRect(x + w * 0.62, groundY - h * 0.55, w * 0.38, stemW);
    ctx.fillRect(x + w * 0.62 + w * 0.38 - stemW, groundY - h * 0.70, stemW, h * 0.22);
  } else {
    ctx.fillRect(x + w * 0.62, groundY - h * 0.60, w * 0.38, stemW);
    ctx.fillRect(x + w * 0.62 + w * 0.38 - stemW, groundY - h * 0.72, stemW, h * 0.20);
  }
  ctx.restore();
}

function _drawBird(ctx, x, topY, w, wingPhase, night) {
  const col = night > 0.5 ? '#7dd3fc' : '#0369a1';
  const h = w * 0.55;
  ctx.save();
  ctx.fillStyle = col;
  ctx.shadowColor = col;
  ctx.shadowBlur = 6;

  // ciało
  ctx.beginPath();
  ctx.ellipse(x + w * 0.5, topY + h * 0.55, w * 0.32, h * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  // głowa
  ctx.beginPath();
  ctx.arc(x + w * 0.82, topY + h * 0.42, h * 0.24, 0, Math.PI * 2);
  ctx.fill();
  // dziób
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.moveTo(x + w, topY + h * 0.40);
  ctx.lineTo(x + w * 1.12, topY + h * 0.44);
  ctx.lineTo(x + w, topY + h * 0.50);
  ctx.fill();
  // skrzydła
  const wa = Math.sin(wingPhase) * 0.55;
  ctx.fillStyle = col;
  ctx.save();
  ctx.translate(x + w * 0.5, topY + h * 0.5);
  ctx.rotate(-wa);
  ctx.beginPath();
  ctx.ellipse(-w * 0.05, 0, w * 0.52, h * 0.18, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(x + w * 0.5, topY + h * 0.55);
  ctx.rotate(wa);
  ctx.beginPath();
  ctx.ellipse(w * 0.05, 0, w * 0.52, h * 0.18, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.restore();
}

function _drawCloud(ctx, x, y, w, night) {
  const col = night > 0.5 ? '#334155' : '#fff';
  ctx.fillStyle = col;
  const h = w * 0.38;
  ctx.beginPath();
  ctx.arc(x + w * 0.25, y + h * 0.55, h * 0.55, 0, Math.PI * 2);
  ctx.arc(x + w * 0.50, y + h * 0.35, h * 0.70, 0, Math.PI * 2);
  ctx.arc(x + w * 0.75, y + h * 0.55, h * 0.52, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x + w * 0.25 - h * 0.55, y + h * 0.55, w * 0.50 + h * 1.07, h * 0.45);
}
