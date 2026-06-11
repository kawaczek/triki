// games/pong/game.js — Triki Arkanoid
// Sterowanie: obrót kapsla (triki.ROT = gz żyroskop) rusza paletką, kliknięcie = wystrzelenie piłki / strzał laserem.

import { clamp, drawGrid, radialGlow } from '../../static/gameutils.js';

const TILE_W = 0.09;  // szerokość kafelka klocka (znormalizowana 0..1)
const TILE_H = 0.04;  // wysokość kafelka klocka
const PAD_H  = 0.03;  // wysokość paletki
const PAD_W0 = 0.18;  // bazowa szerokość paletki
const BALL_R = 0.015;
const BALL_SPEED = 0.5; // znormalizowana prędkość (jednostek na sekundę)

// Definicje poziomów (układ klocków 5 wierszy x 10 kolumn)
// 0 = puste, 1 = zielony (1 HP), 2 = niebieski (1 HP), 3 = żółty (2 HP), 4 = czerwony (1 HP)
const LEVELS = [
  // Poziom 1: Klasyczne pasy
  [
    [4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
    [2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  ],
  // Poziom 2: Piramida z twardym środkiem
  [
    [0, 0, 3, 3, 3, 3, 3, 3, 0, 0],
    [0, 2, 2, 4, 4, 4, 4, 2, 2, 0],
    [1, 1, 1, 2, 2, 2, 2, 1, 1, 1],
    [0, 0, 1, 1, 0, 0, 1, 1, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  ],
  // Poziom 3: Szachownica i mur
  [
    [3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
    [4, 0, 4, 0, 4, 0, 4, 0, 4, 0],
    [2, 2, 0, 2, 2, 0, 2, 2, 0, 2],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [3, 0, 0, 0, 3, 3, 0, 0, 0, 3]
  ],
  // Poziom 4: Twierdza — czerwone mury, żółty skarbiec w środku
  [
    [4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
    [4, 0, 0, 0, 0, 0, 0, 0, 0, 4],
    [4, 0, 3, 3, 3, 3, 3, 3, 0, 4],
    [4, 0, 0, 0, 0, 0, 0, 0, 0, 4],
    [4, 4, 4, 0, 0, 0, 0, 4, 4, 4]
  ],
  // Poziom 5: Zygzak
  [
    [3, 3, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 2, 2, 2, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 1, 1, 1, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 2, 2, 2, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 3, 3, 3]
  ],
  // Poziom 6: Finałowy mur
  [
    [3, 4, 3, 4, 3, 3, 4, 3, 4, 3],
    [2, 3, 2, 3, 2, 2, 3, 2, 3, 2],
    [3, 2, 3, 2, 3, 3, 2, 3, 2, 3],
    [1, 1, 1, 0, 1, 1, 0, 1, 1, 1],
    [0, 3, 0, 3, 0, 0, 3, 0, 3, 0]
  ]
];

const COLORS = {
  1: '#22c55e', // zielony
  2: '#3b82f6', // niebieski
  3: '#eab308', // żółty (2 HP)
  4: '#ef4444'  // czerwony
};

export default class Arkanoid {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.triki = triki;
    this.emit = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;

    this._mx = 0.5;
    this._keys = { ArrowLeft: false, ArrowRight: false };

    // Ustawienia początkowe
    this.levelIndex = 0;
    this.score = 0;
    this.lives = 3;
    this.maxLives = 5;

    // Elementy gry
    this.padX = 0.5;
    this.padW = PAD_W0;
    this.balls = [];
    this.bricks = []; // { x, y, type, hp, maxHp }
    this.powerups = []; // { x, y, type, r }
    this.lasers = []; // { x, y, vy }
    this.particles = [];

    // Stan piłki przyklejonej do paletki
    this.stickyBall = true;

    // Czasy ulepszeń (aktywne efekty)
    this.expandTimer = 0;
    this.laserTimer = 0;
  }

  start(player) {
    this.player = player;
    this.levelIndex = 0;
    this.score = 0;
    this.lives = 3;
    this.stickyBall = true;
    this.expandTimer = 0;
    this.laserTimer = 0;
    this.padW = PAD_W0;
    this.powerups = [];
    this.lasers = [];
    this.particles = [];

    this.loadLevel(this.levelIndex);
    this.running = true;
    this._emitStats();
  }

  loadLevel(idx) {
    this.bricks = [];
    this.balls = [];
    this.lasers = [];
    this.powerups = [];
    this.stickyBall = true;
    this.expandTimer = 0;
    this.laserTimer = 0;
    this.padW = PAD_W0;

    const layout = LEVELS[idx % LEVELS.length];
    const rows = layout.length;
    const cols = layout[0].length;

    // Centrujemy klocki w poziomie: margines lewy i prawy
    const startX = (1.0 - (cols * TILE_W)) / 2;
    const startY = 0.12;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const type = layout[r][c];
        if (type > 0) {
          const hp = type === 3 ? 2 : 1; // Żółte klocki mają 2 HP, inne 1 HP
          this.bricks.push({
            x: startX + c * TILE_W,
            y: startY + r * TILE_H,
            type: type,
            hp: hp,
            maxHp: hp
          });
        }
      }
    }

    // Dodanie pierwszej piłki przyklejonej do paletki
    this.balls.push({
      x: this.padX,
      y: 1.0 - PAD_H - 0.02 - BALL_R,
      vx: 0,
      vy: 0,
      r: BALL_R
    });
  }

  resize(W, H) {
    this.W = W;
    this.H = H;
  }

  onMouseMove(nx) {
    this._mx = nx;
  }

  onClick() {
    this.handleAction();
  }

  onKeyDown(code) {
    if (code in this._keys) this._keys[code] = true;
    if (code === 'Space') this.handleAction();
  }

  onKeyUp(code) {
    if (code in this._keys) this._keys[code] = false;
  }

  handleAction() {
    if (!this.running) return;

    // 1. Wystrzelenie przyklejonej piłki
    if (this.stickyBall && this.balls.length > 0) {
      this.stickyBall = false;
      const b = this.balls[0];
      const angle = (Math.random() * 40 - 20) * Math.PI / 180; // lekki losowy kąt
      b.vx = BALL_SPEED * Math.sin(angle);
      b.vy = -BALL_SPEED * Math.cos(angle);
    }
    // 2. Strzał laserem, jeśli ulepszenie jest aktywne
    else if (this.laserTimer > 0) {
      const padY = 1.0 - PAD_H - 0.02;
      const hw = this.padW / 2;

      // Dwa pociski po bokach paletki
      this.lasers.push({ x: this.padX - hw + 0.02, y: padY, vy: -0.8 });
      this.lasers.push({ x: this.padX + hw - 0.02, y: padY, vy: -0.8 });
    }
  }

  spawnParticle(x, y, color, count = 5) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 0.05 + Math.random() * 0.15;
      this.particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        color: color,
        life: 250 + Math.random() * 250,
        maxLife: 500
      });
    }
  }

  update(dt) {
    if (!this.running) return;
    const s = dt / 1000; // sekundy

    // Aktualizacja liczników ulepszeń
    if (this.expandTimer > 0) {
      this.expandTimer -= dt;
      if (this.expandTimer <= 0) this.padW = PAD_W0; // Powrót do normy
    }
    if (this.laserTimer > 0) {
      this.laserTimer -= dt;
    }

    // Obsługa strzału laserem z kapsla (kliknięcie fizyczne)
    if (this.triki.connected && this.triki.consumeClick()) {
      this.handleAction();
    }

    // 1. Ruch paletki — tryb wybierany na ekranie startowym (ctrlmode_pong):
    //    'rotate' = gz raw, 'tilt' = przechył ax, 'swing' = machanie, 'gyrodrift' = gz auto-drift (VeltoKit)
    const sensRot   = 0.00018 / 16;
    const sensTilt  = 0.00006;
    const sensSwing = 0.00003;
    const sensDrift = 0.00018 / 16;  // taka sama czułość jak rotate, ale drift skompensowany
    if (this.triki.connected) {
      const mode = (typeof localStorage !== 'undefined' && localStorage.getItem('ctrlmode_pong')) || 'rotate';
      if      (mode === 'tilt')      this.padX -= this.triki.GZ() * sensTilt * dt;
      else if (mode === 'swing')     this.padX -= this.triki.GZ() * sensSwing * dt;
      else if (mode === 'gyrodrift') this.padX -= this.triki.ROTD() * sensDrift * dt;
      else                           this.padX -= this.triki.ROT() * sensRot * dt;
    } else if (this._keys.ArrowLeft || this._keys.ArrowRight) {
      this.padX += (this._keys.ArrowRight ? 1 : -1) * 0.7 * s;
    } else {
      this.padX = this.padX + (this._mx - this.padX) * 0.18;
    }
    this.padX = clamp(this.padX, this.padW / 2, 1.0 - this.padW / 2);

    // Jeśli piłka jest przyklejona, podąża za paletką
    if (this.stickyBall && this.balls.length > 0) {
      this.balls[0].x = this.padX;
      this.balls[0].y = 1.0 - PAD_H - 0.02 - BALL_R;
    }

    // 2. Ruch i fizyka piłek
    if (!this.stickyBall) {
      this.balls.forEach(b => {
        b.x += b.vx * s;
        b.y += b.vy * s;

        // Odbicia od ścian bocznych
        if (b.x < b.r) {
          b.x = b.r;
          b.vx = Math.abs(b.vx);
        }
        if (b.x > 1.0 - b.r) {
          b.x = 1.0 - b.r;
          b.vx = -Math.abs(b.vx);
        }
        // Odbicie od sufitu
        if (b.y < b.r) {
          b.y = b.r;
          b.vy = Math.abs(b.vy);
        }

        // Odbicie od paletki (na dole)
        const padY = 1.0 - PAD_H - 0.02;
        if (b.y + b.r >= padY && b.y - b.r <= padY + PAD_H &&
            Math.abs(b.x - this.padX) < this.padW / 2 + b.r && b.vy > 0) {
          // Odbicie zależne od miejsca uderzenia w paletkę
          const relX = (b.x - this.padX) / (this.padW / 2);
          const angle = relX * 65 * Math.PI / 180; // Maksymalny kąt odbicia 65 stopni
          const spd = Math.hypot(b.vx, b.vy);
          b.vx = spd * Math.sin(angle);
          b.vy = -Math.abs(spd * Math.cos(angle));
          b.y = padY - b.r;
        }
      });
    }

    // Filtrowanie piłek, które spadły poniżej ekranu
    const prevBallCount = this.balls.length;
    this.balls = this.balls.filter(b => b.y <= 1.0 + b.r);

    // Jeśli straciliśmy wszystkie piłki
    if (this.balls.length === 0 && prevBallCount > 0) {
      this.lives--;
      this._emitStats();

      if (this.lives <= 0) {
        this.gameOver();
        return;
      } else {
        // Zrespawnuj piłkę na paletce
        this.stickyBall = true;
        this.expandTimer = 0;
        this.laserTimer = 0;
        this.padW = PAD_W0;
        this.balls.push({
          x: this.padX,
          y: 1.0 - PAD_H - 0.02 - BALL_R,
          vx: 0,
          vy: 0,
          r: BALL_R
        });
      }
    }

    // 3. Kolizje piłek z klockami (Arkanoid Bricks)
    this.balls.forEach(b => {
      this.bricks.forEach(brick => {
        if (brick.hp <= 0) return;

        // Kolizja AABB
        const bxMin = brick.x;
        const bxMax = brick.x + TILE_W;
        const byMin = brick.y;
        const byMax = brick.y + TILE_H;

        // Znajdź najbliższy punkt na klocku względem środka piłki
        const nearestX = Math.max(bxMin, Math.min(b.x, bxMax));
        const nearestY = Math.max(byMin, Math.min(b.y, byMax));

        const distLX = b.x - nearestX;
        const distLY = b.y - nearestY;
        const distSq = distLX * distLX + distLY * distLY;

        if (distSq < b.r * b.r) {
          // Nastąpiło uderzenie!
          brick.hp--;
          this.score += 10;
          this.spawnParticle(nearestX + TILE_W / 2, nearestY + TILE_H / 2, COLORS[brick.type], 8);

          // Odbicie piłki (odwrócenie wektora prędkości)
          // Określamy z której strony uderzyła piłka
          const overlapX = b.r - Math.abs(distLX);
          const overlapY = b.r - Math.abs(distLY);

          if (overlapX < overlapY) {
            b.vx = distLX > 0 ? Math.abs(b.vx) : -Math.abs(b.vx);
          } else {
            b.vy = distLY > 0 ? Math.abs(b.vy) : -Math.abs(b.vy);
          }

          // Sprawdzenie, czy klocek uległ zniszczeniu
          if (brick.hp <= 0) {
            this.score += 20; // dodatkowe punkty za rozbicie
            this.handleBrickBreak(brick.x + TILE_W / 2, brick.y + TILE_H / 2);
          }
          this._emitStats();
        }
      });
    });

    // 4. Ruch i kolizje laserów (l.y znormalizowane 0..1)
    this.lasers.forEach(l => {
      l.y += l.vy * s;
    });

    this.lasers = this.lasers.filter(l => {
      if (l.y < 0) return false; // wylatuje poza ekran

      let hit = false;
      this.bricks.forEach(brick => {
        if (hit || brick.hp <= 0) return;

        const bxMin = brick.x;
        const bxMax = brick.x + TILE_W;
        const byMin = brick.y;
        const byMax = brick.y + TILE_H;

        const lx = l.x;
        const ly = l.y;

        if (lx >= bxMin && lx <= bxMax && ly >= byMin && ly <= byMax) {
          hit = true;
          brick.hp--;
          this.score += 15;
          this.spawnParticle(brick.x + TILE_W / 2, brick.y + TILE_H / 2, COLORS[brick.type], 6);

          if (brick.hp <= 0) {
            this.score += 20;
            this.handleBrickBreak(brick.x + TILE_W / 2, brick.y + TILE_H / 2);
          }
          this._emitStats();
        }
      });

      return !hit;
    });

    // Usuwanie zniszczonych klocków
    // (uwaga: liczymy PRZED filtrowaniem — wcześniej liczone po, przez co
    // warunek nigdy nie był spełniony i poziom się nie przełączał)
    const hadBricks = this.bricks.length > 0;
    this.bricks = this.bricks.filter(br => br.hp > 0);

    // Wygrana poziomu!
    if (this.bricks.length === 0 && hadBricks) {
      this.nextLevel();
      return;
    }

    // 5. Aktualizacja spadających Ulepszeń (Power-upów)
    this.powerups.forEach(p => {
      p.y += 0.15 * s; // powolne spadanie
    });

    // Łapanie ulepszeń paletką
    this.powerups = this.powerups.filter(p => {
      const padY = 1.0 - PAD_H - 0.02;

      // Sprawdzenie kolizji koło (ulepszenie) - prostokąt (paletka)
      if (p.y + p.r >= padY && p.y - p.r <= padY + PAD_H &&
          Math.abs(p.x - this.padX) < this.padW / 2 + p.r) {
        // Złapane!
        this.activatePowerup(p.type);
        this.score += 50;
        this._emitStats();
        return false;
      }
      return p.y <= 1.0 + p.r; // usuń te, co spadły pod ekran
    });

    // 6. Aktualizacja cząsteczek
    this.particles.forEach(p => {
      p.x += p.vx * s;
      p.y += p.vy * s;
      p.life -= dt;
    });
    this.particles = this.particles.filter(p => p.life > 0);
  }

  handleBrickBreak(x, y) {
    // 22% szans na drop ulepszenia
    if (Math.random() < 0.22) {
      const types = ['heart', 'expand', 'multiball', 'laser'];
      const type = types[Math.floor(Math.random() * types.length)];
      this.powerups.push({
        x: x,
        y: y,
        type: type,
        r: 0.015
      });
    }
  }

  activatePowerup(type) {
    this.spawnParticle(this.padX, 1.0 - PAD_H - 0.02, '#3b82f6', 15);

    if (type === 'heart') {
      this.lives = Math.min(this.maxLives, this.lives + 1);
    } else if (type === 'expand') {
      this.padW = PAD_W0 * 1.6;
      this.expandTimer = 8000; // 8 sekund powiększenia
    } else if (type === 'multiball') {
      // Dodaj drugą piłkę z obecnej pozycji pierwszej piłki (lub z paletki)
      if (this.balls.length > 0) {
        const b0 = this.balls[0];
        this.balls.push({
          x: b0.x,
          y: b0.y,
          vx: -b0.vx || -0.2,
          vy: -Math.abs(b0.vy) || -0.4,
          r: BALL_R
        });
      }
    } else if (type === 'laser') {
      this.laserTimer = 8000; // 8 sekund strzelania laserem
    }
  }

  nextLevel() {
    this.levelIndex++;
    if (this.levelIndex < LEVELS.length) {
      this.score += 500; // bonus za poziom
      this.loadLevel(this.levelIndex);
      this._emitStats();
    } else {
      // Wygrana całej gry!
      this.score += 1000; // bonus za ukończenie wszystkich poziomów
      this.running = false;
      this.emit('end', { score: this.score, won: true });
    }
  }

  gameOver() {
    this.running = false;
    this.emit('end', { score: this.score, won: false });
  }

  draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);
    drawGrid(ctx, W, H, 0.03);

    // 1. Rysowanie klocków (cegiełek)
    this.bricks.forEach(brick => {
      const bx = brick.x * W;
      const by = brick.y * H;
      const bw = TILE_W * W;
      const bh = TILE_H * H;

      ctx.save();
      ctx.fillStyle = COLORS[brick.type];
      ctx.shadowColor = COLORS[brick.type];
      ctx.shadowBlur = brick.hp > 1 ? 10 : 3;

      // Zaokrąglony prostokąt dla ładnego wyglądu klocka
      ctx.beginPath();
      ctx.roundRect(bx + 1.5, by + 1.5, bw - 3, bh - 3, 4);
      ctx.fill();

      // Pęknięcie na klockach o większym HP (żółtych)
      if (brick.hp > 1) {
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(bx + bw / 3, by + 2);
        ctx.lineTo(bx + bw / 2, by + bh / 2);
        ctx.lineTo(bx + bw / 4, by + bh - 2);
        ctx.stroke();
      }
      ctx.restore();
    });

    // 2. Rysowanie laserów
    this.lasers.forEach(l => {
      const lx = l.x * W;
      const ly = l.y * H;
      ctx.save();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx, ly - 15);
      ctx.stroke();
      ctx.restore();
    });

    // 3. Rysowanie ulepszeń (power-upów)
    this.powerups.forEach(p => {
      const px = p.x * W;
      const py = p.y * H;
      const pr = p.r * Math.min(W, H);

      ctx.save();
      let color = '#fff';
      let symbol = '❓';

      if (p.type === 'heart') { color = '#ef4444'; symbol = '❤️'; }
      else if (p.type === 'expand') { color = '#3b82f6'; symbol = '🌟'; }
      else if (p.type === 'multiball') { color = '#22c55e'; symbol = '⚾'; }
      else if (p.type === 'laser') { color = '#ec4899'; symbol = '🔫'; }

      radialGlow(ctx, px, py, pr * 2.5, color, 0.3);

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fff';
      ctx.font = `${pr * 1.3}px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(symbol, px, py);
      ctx.restore();
    });

    // 4. Rysowanie paletki
    const pw = this.padW * W;
    const ph = PAD_H * H;
    const padY_px = (1 - PAD_H - 0.02) * H;
    const padX_px = this.padX * W;

    ctx.save();
    let padColor = '#3b82f6'; // Domyślny niebieski
    if (this.laserTimer > 0) padColor = '#ec4899'; // Różowy pod laserem
    else if (this.expandTimer > 0) padColor = '#a855f7'; // Fioletowy pod rozszerzeniem

    drawPaddle(ctx, padX_px - pw / 2, padY_px, pw, ph, padColor);

    // Narysowanie działek laserowych na paletce
    if (this.laserTimer > 0) {
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(padX_px - pw / 2 + 5, padY_px - 4, 6, 4);
      ctx.fillRect(padX_px + pw / 2 - 11, padY_px - 4, 6, 4);
    }
    ctx.restore();

    // 5. Rysowanie piłek
    this.balls.forEach(b => {
      const bx = b.x * W;
      const by = b.y * H;
      const br = b.r * Math.min(W, H);

      ctx.save();
      radialGlow(ctx, bx, by, br * 3, '#f0f0f0', 0.4);
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();
    });

    // 6. Rysowanie cząsteczek
    this.particles.forEach(p => {
      ctx.save();
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x * W, p.y * H, 3 + Math.random() * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  drawIdle() {
    this.draw();
  }

  destroy() {
    this.running = false;
  }

  _emitStats() {
    let hpStr = '';
    for (let i = 0; i < this.maxLives; i++) {
      hpStr += i < this.lives ? '❤️' : '🖤';
    }

    let pwrStr = '';
    if (this.laserTimer > 0) pwrStr = ' 🔫 LASER';
    else if (this.expandTimer > 0) pwrStr = ' 🌟 EXPAND';

    this.emit(
      'stats',
      `<span style="color:#ef4444">${hpStr}</span> &nbsp;·&nbsp; ` +
        `🧱 Poz: <b>${this.levelIndex + 1}/${LEVELS.length}</b> &nbsp;·&nbsp; ` +
        `🏆 Wynik: <b>${this.score}</b>` +
        `<span style="color:#a855f7; font-weight:bold">${pwrStr}</span>`
    );
  }
}

// ── helpers ──────────────────────────────────────────────────
function drawPaddle(ctx, x, y, w, h, color) {
  const r = h / 2;
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 15;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.restore();
}

