// games/czolgi/game.js — Czołgi! (top-down tank arena)
// Sterowanie kapslem:
//   Przechyl L/R (-GZ() > 10) → jedź w kierunku lufy
//   GZ() (mały) → skręt podwozia
//   ROT() → obrót lufy niezależnie
//   Klik → strzał (max 2 pociski naraz)

import { clamp, rand, radialGlow } from '../../static/gameutils.js';

const PLAYER_HP      = 5;
const ENEMY_HP       = 3;
const BULLET_SPEED   = 0.38;   // px/ms (przy normalizacji do min(W,H))
const BULLET_LIFE    = 2000;   // ms
const BULLET_MAX     = 2;      // max pocisków gracza naraz
const SHOT_CD        = 500;    // ms cooldown gracza
const ENEMY_SHOT_CD  = 2500;   // ms cooldown wroga
const TANK_SIZE      = 22;     // px (połowa boku)
const WALL_PAD       = TANK_SIZE;
const EXPL_LIFE      = 600;    // ms eksplozji

// Konfiguracja fali: liczba wrogów per fala, punkty za zniszczenie
const BASE_ENEMIES   = 3;

export default class CzolgiGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas  = canvas;
    this.ctx     = ctx;
    this.triki   = triki;
    this.emit    = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;

    // Gracz
    this._px = 0; this._py = 0;
    this._bodyAngle = 0;   // kąt podwozia
    this._aimAngle  = 0;   // kąt lufy
    this._playerHP  = PLAYER_HP;
    this._shotCd    = 0;
    this._hurtT     = 0;   // mignięcie obrażeń (ms)

    // Wrogowie
    this._enemies = [];

    // Pociski: [{x,y,vx,vy,life,owner}]
    this._bullets = [];

    // Eksplozje: [{x,y,t,maxT,r,color}]
    this._explosions = [];

    // Przeszkody (prostokąty): [{x,y,w,h}]
    this._walls = [];

    // Wynik i fala
    this._score = 0;
    this._wave  = 1;

    // Klawiatura / mysz
    this._keys  = {};
    this._mx    = 0.5; this._my = 0.5;
    this._t     = 0;

    // Banner
    this._banner = null;

    // Inicjalizuj stan do drawIdle
    this._initLevel();
  }

  // ─── Init ────────────────────────────────────────────────
  _initLevel() {
    const W = this.W, H = this.H;
    const cx = W / 2, cy = H / 2;

    // Gracz w lewym górnym kwadrancie
    this._px = W * 0.18;
    this._py = H * 0.18;
    this._bodyAngle = Math.PI / 4;
    this._aimAngle  = this._bodyAngle;
    this._playerHP  = PLAYER_HP;
    this._shotCd    = 0;
    this._hurtT     = 0;

    // Przeszkody (cover blocki)
    this._walls = this._buildWalls();

    // Wrogowie
    const numEnemies = BASE_ENEMIES + (this._wave - 1) * 2;
    this._enemies = [];
    for (let i = 0; i < numEnemies; i++) {
      this._spawnEnemy();
    }

    this._bullets    = [];
    this._explosions = [];
  }

  _buildWalls() {
    const W = this.W, H = this.H;
    const pad = 40;
    // 5 prostokątnych cover-bloków
    return [
      { x: W*0.35, y: H*0.15, w: W*0.12, h: H*0.08 },
      { x: W*0.60, y: H*0.30, w: W*0.10, h: H*0.12 },
      { x: W*0.18, y: H*0.42, w: W*0.14, h: H*0.07 },
      { x: W*0.42, y: H*0.50, w: W*0.16, h: H*0.09 },
      { x: W*0.65, y: H*0.62, w: W*0.10, h: H*0.11 },
    ];
  }

  _spawnEnemy() {
    const W = this.W, H = this.H;
    // Spawuj daleko od gracza (prawy/dolny obszar)
    for (let t = 0; t < 40; t++) {
      const x = rand(W * 0.45, W - WALL_PAD);
      const y = rand(H * 0.45, H - WALL_PAD);
      const dist = Math.hypot(x - this._px, y - this._py);
      if (dist < W * 0.28) continue;
      if (this._collidesWall(x, y, TANK_SIZE)) continue;
      const angle = rand(0, Math.PI * 2);
      this._enemies.push({
        x, y,
        angle,         // podwozie
        aimAngle: angle,
        hp: ENEMY_HP,
        maxHp: ENEMY_HP,
        shotCd: rand(500, ENEMY_SHOT_CD),
        dirT:  rand(2000, 4000), // czas do zmiany kierunku
        speed: rand(0.045, 0.075), // px/ms
        vx: Math.cos(angle) * 0.055,
        vy: Math.sin(angle) * 0.055,
      });
      return;
    }
    // Fallback: dolny prawy narożnik
    this._enemies.push({
      x: W * 0.8, y: H * 0.8,
      angle: Math.PI,
      aimAngle: Math.PI,
      hp: ENEMY_HP, maxHp: ENEMY_HP,
      shotCd: ENEMY_SHOT_CD,
      dirT: 3000, speed: 0.06,
      vx: -0.06, vy: 0,
    });
  }

  // ─── Lifecycle ───────────────────────────────────────────
  start(player) {
    this.player = player;
    this._score  = 0;
    this._wave   = 1;
    this._banner = { text: 'FALA 1', t: 1500, color: '#22c55e' };
    this._initLevel();
    this.running = true;
    this._emitStats();
  }

  resize(W, H) {
    this.W = W; this.H = H;
    this._walls = this._buildWalls();
  }

  onMouseMove(nx, ny) {
    this._mx = nx; this._my = ny;
    // Celowanie myszą (bez kapsla): ustaw aimAngle w kierunku kursora
    if (!this.triki.connected) {
      this._aimAngle = Math.atan2(ny * this.H - this._py, nx * this.W - this._px);
    }
  }

  onClick(nx, ny) { this._shoot(); }

  onKeyDown(code) {
    this._keys[code] = true;
    if (code === 'Space') this._shoot();
  }

  onKeyUp(code) { this._keys[code] = false; }

  // ─── Kolizje ─────────────────────────────────────────────
  _collidesWall(x, y, r) {
    for (const w of this._walls) {
      if (x + r > w.x && x - r < w.x + w.w &&
          y + r > w.y && y - r < w.y + w.h) return true;
    }
    return false;
  }

  _collidesWallSeg(x1, y1, x2, y2) {
    // Prosta kolizja pocisku ze ścianą (AABB vs linia — uproszczona)
    for (const w of this._walls) {
      if (x2 > w.x && x2 < w.x + w.w && y2 > w.y && y2 < w.y + w.h) return true;
    }
    return false;
  }

  // ─── Strzał ──────────────────────────────────────────────
  _shoot() {
    if (!this.running) return;
    if (this._shotCd > 0) return;
    const playerBullets = this._bullets.filter(b => b.owner === 'player');
    if (playerBullets.length >= BULLET_MAX) return;

    this._shotCd = SHOT_CD;
    const speed = BULLET_SPEED;
    this._bullets.push({
      x: this._px + Math.cos(this._aimAngle) * (TANK_SIZE + 6),
      y: this._py + Math.sin(this._aimAngle) * (TANK_SIZE + 6),
      vx: Math.cos(this._aimAngle) * speed,
      vy: Math.sin(this._aimAngle) * speed,
      life: BULLET_LIFE,
      bounced: 0,
      owner: 'player',
    });
  }

  _enemyShoot(e) {
    const speed = BULLET_SPEED * 0.75;
    this._bullets.push({
      x: e.x + Math.cos(e.aimAngle) * (TANK_SIZE + 6),
      y: e.y + Math.sin(e.aimAngle) * (TANK_SIZE + 6),
      vx: Math.cos(e.aimAngle) * speed,
      vy: Math.sin(e.aimAngle) * speed,
      life: BULLET_LIFE,
      bounced: 0,
      owner: 'enemy',
    });
  }

  // ─── Update ──────────────────────────────────────────────
  update(dt) {
    if (!this.running) return;
    this._t += dt;

    // Banner
    if (this._banner) { this._banner.t -= dt; if (this._banner.t <= 0) this._banner = null; }

    // Cooldowny
    if (this._shotCd > 0) this._shotCd = Math.max(0, this._shotCd - dt);
    if (this._hurtT > 0)  this._hurtT  = Math.max(0, this._hurtT  - dt);

    // ── Sterowanie graczem ────────────────────────────────
    if (this.triki.connected) {
      const gz = -this.triki.GZ(); // + = prawo
      const rot = this.triki.ROT();

      // Skręt podwozia (mały przechył)
      this._bodyAngle += gz * 0.003 * dt;

      // Obrót lufy (ROT kapsla)
      this._aimAngle += rot * 0.002 * dt;

      // Jazda (duży przechył = jedź w kierunku lufy)
      const speed = 0.12;
      if (Math.abs(gz) > 10) {
        const dir = gz > 0 ? 1 : -1;
        const nx = this._px + Math.cos(this._aimAngle) * speed * dt * dir;
        const ny = this._py + Math.sin(this._aimAngle) * speed * dt * dir;
        this._movePlayer(nx, ny);
      }

      if (this.triki.consumeClick()) this._shoot();

    } else {
      // Klawiatura WSAD
      const sp = 0.14;
      let nx = this._px, ny = this._py;
      let moved = false;
      if (this._keys['KeyW'] || this._keys['ArrowUp']) {
        nx += Math.cos(this._aimAngle) * sp * dt;
        ny += Math.sin(this._aimAngle) * sp * dt;
        moved = true;
      }
      if (this._keys['KeyS'] || this._keys['ArrowDown']) {
        nx -= Math.cos(this._aimAngle) * sp * dt;
        ny -= Math.sin(this._aimAngle) * sp * dt;
        moved = true;
      }
      if (this._keys['KeyA'] || this._keys['ArrowLeft']) {
        this._aimAngle -= 0.004 * dt;
        this._bodyAngle -= 0.004 * dt;
      }
      if (this._keys['KeyD'] || this._keys['ArrowRight']) {
        this._aimAngle += 0.004 * dt;
        this._bodyAngle += 0.004 * dt;
      }
      if (moved) this._movePlayer(nx, ny);
    }

    // ── AI wrogów ────────────────────────────────────────
    for (const e of this._enemies) {
      e.dirT -= dt;
      if (e.dirT <= 0) {
        // Zmień kierunek: losowy lub w stronę gracza
        const toPlayer = Math.atan2(this._py - e.y, this._px - e.x);
        const bias = Math.random() < 0.6 ? toPlayer : rand(0, Math.PI * 2);
        e.angle = bias + rand(-0.5, 0.5);
        e.vx = Math.cos(e.angle) * e.speed;
        e.vy = Math.sin(e.angle) * e.speed;
        e.dirT = rand(2000, 4000);
      }

      // Celuj w gracza
      const da = Math.atan2(this._py - e.y, this._px - e.x);
      const diff = angleDiff(da, e.aimAngle);
      e.aimAngle += clamp(diff, -0.005 * dt, 0.005 * dt);

      // Ruch AI
      const ex = e.x + e.vx * dt;
      const ey = e.y + e.vy * dt;
      const edgePad = TANK_SIZE;
      if (ex > edgePad && ex < this.W - edgePad &&
          ey > edgePad && ey < this.H - edgePad &&
          !this._collidesWall(ex, ey, TANK_SIZE * 0.8)) {
        e.x = ex; e.y = ey;
      } else {
        // Odbij się
        e.angle += Math.PI * (0.7 + Math.random() * 0.6);
        e.vx = Math.cos(e.angle) * e.speed;
        e.vy = Math.sin(e.angle) * e.speed;
        e.dirT = rand(800, 2000);
      }

      // Strzał
      e.shotCd -= dt;
      if (e.shotCd <= 0) {
        e.shotCd = ENEMY_SHOT_CD * rand(0.8, 1.2);
        const dSq = (this._px - e.x)**2 + (this._py - e.y)**2;
        if (dSq < (this.W * 0.85)**2) this._enemyShoot(e);
      }
    }

    // ── Pociski ──────────────────────────────────────────
    const toRemove = [];
    for (let i = 0; i < this._bullets.length; i++) {
      const b = this._bullets[i];
      b.life -= dt;
      if (b.life <= 0) { toRemove.push(i); continue; }

      const nx = b.x + b.vx * dt;
      const ny = b.y + b.vy * dt;

      // Kolizja ze ścianami areny
      if (nx < 2 || nx > this.W - 2 || ny < 2 || ny > this.H - 2) {
        if (b.bounced < 1) {
          b.bounced++;
          if (nx < 2 || nx > this.W - 2) b.vx = -b.vx;
          else b.vy = -b.vy;
        } else {
          toRemove.push(i);
          continue;
        }
      }

      // Kolizja z cover-murami
      if (this._collidesWallSeg(b.x, b.y, nx, ny)) {
        if (b.bounced < 1) {
          b.bounced++;
          // Prosta refleksja — sprawdź czy odbiło się od X czy Y ściany
          b.vx = -b.vx;
          b.vy = -b.vy;
        } else {
          toRemove.push(i);
          continue;
        }
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        continue;
      }

      b.x = nx; b.y = ny;

      // Trafienie gracza przez wrogi pocisk
      if (b.owner === 'enemy') {
        const dSq = (b.x - this._px)**2 + (b.y - this._py)**2;
        if (dSq < (TANK_SIZE * 1.1)**2) {
          this._playerHP--;
          this._hurtT = 400;
          this._boom(b.x, b.y, '#ef4444', 8);
          toRemove.push(i);
          this._emitStats();
          if (this._playerHP <= 0) {
            this._boom(this._px, this._py, '#f97316', 20);
            this.running = false;
            this.emit('end', { score: this._score });
            return;
          }
          continue;
        }
      }

      // Trafienie wroga przez pocisk gracza
      if (b.owner === 'player') {
        let hit = false;
        for (const e of this._enemies) {
          const dSq = (b.x - e.x)**2 + (b.y - e.y)**2;
          if (dSq < (TANK_SIZE * 1.1)**2) {
            e.hp--;
            this._boom(b.x, b.y, '#fbbf24', 8);
            this._score += 10;
            hit = true;
            break;
          }
        }
        if (hit) { toRemove.push(i); this._emitStats(); }
      }
    }

    // Usuń pociski od końca, żeby indeksy były prawidłowe
    for (let k = toRemove.length - 1; k >= 0; k--) {
      this._bullets.splice(toRemove[k], 1);
    }

    // Wrogowie z 0 HP → eksplozja + punkty
    const deadEnemies = this._enemies.filter(e => e.hp <= 0);
    deadEnemies.forEach(e => {
      this._boom(e.x, e.y, '#f97316', 20);
      this._score += 100;
    });
    this._enemies = this._enemies.filter(e => e.hp > 0);
    if (deadEnemies.length > 0) this._emitStats();

    // Nowa fala?
    if (this._enemies.length === 0) {
      this._wave++;
      this._banner = { text: `FALA ${this._wave}!`, t: 1800, color: '#22c55e' };
      this._score += 200;
      this._initLevel();
      // Przywróć HP gracza (częściowo)
      this._playerHP = Math.min(PLAYER_HP, this._playerHP + 2);
      this._emitStats();
    }

    // Eksplozje
    this._explosions = this._explosions.filter(ex => { ex.t -= dt; return ex.t > 0; });
  }

  _movePlayer(nx, ny) {
    const pad = TANK_SIZE;
    nx = clamp(nx, pad, this.W - pad);
    ny = clamp(ny, pad, this.H - pad);
    if (!this._collidesWall(nx, this._py, TANK_SIZE * 0.8)) this._px = nx;
    if (!this._collidesWall(this._px, ny, TANK_SIZE * 0.8)) this._py = ny;
  }

  _boom(x, y, color, n) {
    this._explosions.push({ x, y, t: EXPL_LIFE, maxT: EXPL_LIFE, r: TANK_SIZE * 1.8, color, n });
  }

  // ─── Draw ────────────────────────────────────────────────
  draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    // Pole bitwy — ciemnozielona mapa z siatką
    ctx.fillStyle = '#0d1a0d';
    ctx.fillRect(0, 0, W, H);

    // Siatka taktyczna
    ctx.save();
    ctx.strokeStyle = 'rgba(34,197,94,0.07)';
    ctx.lineWidth = 1;
    const gs = 40;
    for (let x = 0; x < W; x += gs) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y = 0; y < H; y += gs) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
    ctx.restore();

    // Cover-bloki (mury)
    for (const w of this._walls) {
      ctx.save();
      ctx.fillStyle = '#374151';
      ctx.strokeStyle = '#6b7280';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(w.x, w.y, w.w, w.h, 4);
      ctx.fill();
      ctx.stroke();
      // Cieniowanie góry
      ctx.fillStyle = 'rgba(156,163,175,0.18)';
      ctx.beginPath();
      ctx.roundRect(w.x + 2, w.y + 2, w.w - 4, w.h * 0.25, 3);
      ctx.fill();
      ctx.restore();
    }

    // Eksplozje
    for (const ex of this._explosions) {
      const progress = 1 - ex.t / ex.maxT;
      const r = ex.r * (0.3 + progress * 0.7);
      const alpha = ex.t / ex.maxT;
      radialGlow(ctx, ex.x, ex.y, r * 1.5, ex.color, alpha * 0.55);
      ctx.save();
      ctx.globalAlpha  = alpha;
      ctx.strokeStyle  = ex.color;
      ctx.lineWidth    = 3 * alpha;
      ctx.shadowColor  = ex.color;
      ctx.shadowBlur   = 16;
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, r, 0, Math.PI * 2);
      ctx.stroke();
      // Wewnętrzny okrąg
      ctx.globalAlpha  = alpha * 0.5;
      ctx.fillStyle    = ex.color;
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, r * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Pociski
    ctx.save();
    ctx.shadowBlur = 10;
    for (const b of this._bullets) {
      ctx.fillStyle   = b.owner === 'player' ? '#fbbf24' : '#f87171';
      ctx.shadowColor = ctx.fillStyle;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
      ctx.fill();
      // Smuga
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.arc(b.x - b.vx * 60, b.y - b.vy * 60, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // Wrogowie
    for (const e of this._enemies) {
      this._drawTank(e.x, e.y, e.angle, e.aimAngle, '#dc2626', '#ef4444', e.hp, e.maxHp);
    }

    // Gracz
    const hurtFlash = this._hurtT > 0 && Math.floor(this._hurtT / 70) % 2 === 0;
    if (!hurtFlash) {
      this._drawTank(this._px, this._py, this._bodyAngle, this._aimAngle, '#16a34a', '#22c55e', this._playerHP, PLAYER_HP, true);
    }

    // HUD: pasek HP gracza
    this._drawHUD();

    // Błysk obrażeń (overlay)
    if (this._hurtT > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(239,68,68,${0.22 * (this._hurtT / 400)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // Banner
    if (this._banner) {
      ctx.save();
      ctx.globalAlpha  = Math.min(1, this._banner.t / 400);
      ctx.fillStyle    = this._banner.color || '#22c55e';
      ctx.font = `900 ${Math.round(W / 8)}px Outfit, sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor  = ctx.fillStyle;
      ctx.shadowBlur   = 26;
      ctx.fillText(this._banner.text, W / 2, H / 2.4);
      ctx.restore();
    }
  }

  _drawTank(x, y, bodyAngle, aimAngle, bodyColor, glowColor, hp, maxHp, isPlayer = false) {
    const { ctx } = this;
    const S = TANK_SIZE;

    ctx.save();
    ctx.translate(x, y);

    // Poświata
    radialGlow(ctx, 0, 0, S * 2, glowColor, isPlayer ? 0.22 : 0.16);

    // Podwozie (obrócony prostokąt)
    ctx.rotate(bodyAngle);
    ctx.fillStyle   = bodyColor;
    ctx.strokeStyle = glowColor;
    ctx.lineWidth   = isPlayer ? 2 : 1.5;
    ctx.beginPath();
    ctx.roundRect(-S, -S * 0.65, S * 2, S * 1.3, 4);
    ctx.fill();
    ctx.stroke();

    // Gąsienice (boczne paski)
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-S, -S * 0.65, S * 2, S * 0.25);
    ctx.fillRect(-S, S * 0.4, S * 2, S * 0.25);

    ctx.restore();

    // Wieżyczka + lufa (niezależny obrót)
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(aimAngle);

    // Lufa
    ctx.strokeStyle = glowColor;
    ctx.lineWidth   = isPlayer ? 5 : 4;
    ctx.lineCap     = 'round';
    ctx.shadowColor = glowColor;
    ctx.shadowBlur  = isPlayer ? 10 : 6;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(S * 1.6, 0);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Wieżyczka (koło)
    ctx.fillStyle   = isPlayer ? '#15803d' : '#b91c1c';
    ctx.strokeStyle = glowColor;
    ctx.lineWidth   = isPlayer ? 2 : 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, S * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Emoji gracza
    if (isPlayer) {
      ctx.font = `${S * 0.6}px sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🐸', 0, 1);
    }

    ctx.restore();

    // Pasek HP (nad czołgiem)
    if (hp < maxHp) {
      const bw = S * 2.2, bh = 5;
      const bx = x - bw / 2, by = y - S - 14;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 3); ctx.fill();
      const col = hp > maxHp * 0.5 ? '#22c55e' : hp > 1 ? '#f59e0b' : '#ef4444';
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.roundRect(bx, by, bw * (hp / maxHp), bh, 3); ctx.fill();
    }
  }

  _drawHUD() {
    const { ctx, W, H } = this;
    const pad = 12;

    // Tło HUD
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.roundRect(pad, pad, 180, 44, 8);
    ctx.fill();

    // HP gracza
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = `bold 11px Outfit, sans-serif`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('HP', pad + 8, pad + 7);

    const hpW = 140, hpH = 10;
    const hx = pad + 28, hy = pad + 6;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath(); ctx.roundRect(hx, hy, hpW, hpH, 5); ctx.fill();

    const hpFrac = this._playerHP / PLAYER_HP;
    const hpCol  = hpFrac > 0.5 ? '#22c55e' : hpFrac > 0.25 ? '#f59e0b' : '#ef4444';
    ctx.fillStyle   = hpCol;
    ctx.shadowColor = hpCol;
    ctx.shadowBlur  = 6;
    ctx.beginPath(); ctx.roundRect(hx, hy, hpW * hpFrac, hpH, 5); ctx.fill();
    ctx.shadowBlur  = 0;

    // Pips HP
    for (let i = 0; i < PLAYER_HP; i++) {
      ctx.fillStyle = i < this._playerHP ? hpCol : 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.arc(hx + (i + 0.5) * (hpW / PLAYER_HP), hy + hpH / 2, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Wrogowie i fala
    ctx.shadowBlur   = 0;
    ctx.fillStyle    = 'rgba(255,255,255,0.75)';
    ctx.font = `bold 12px Outfit, sans-serif`;
    ctx.textBaseline = 'bottom';
    ctx.fillText(`Fala ${this._wave} · Wrogów: ${this._enemies.length}`, pad + 8, pad + 44);

    ctx.restore();

    // Wynik (prawy górny)
    ctx.save();
    ctx.fillStyle    = '#fbbf24';
    ctx.font = `bold ${Math.round(W * 0.045)}px Outfit, sans-serif`;
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'top';
    ctx.shadowColor  = '#f59e0b';
    ctx.shadowBlur   = 8;
    ctx.fillText(`${this._score} pkt`, W - pad, pad);
    ctx.restore();

    // Cooldown strzału (krótki pasek pod HUD)
    if (this._shotCd > 0) {
      const frac = this._shotCd / SHOT_CD;
      ctx.save();
      ctx.fillStyle   = 'rgba(251,191,36,0.7)';
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur  = 5;
      ctx.fillRect(pad, pad + 52, 180 * (1 - frac), 3);
      ctx.restore();
    }
  }

  drawIdle() { this.draw(); }

  destroy() { this.running = false; }

  _emitStats() {
    let hearts = '';
    for (let i = 0; i < PLAYER_HP; i++) hearts += i < this._playerHP ? '❤️' : '🖤';
    this.emit('stats',
      `<span style="color:#ef4444">${hearts}</span> &nbsp;·&nbsp; ` +
      `🌊 Fala <b>${this._wave}</b> &nbsp;·&nbsp; ` +
      `🎯 Wrogów: <b>${this._enemies.length}</b> &nbsp;·&nbsp; ` +
      `🏆 <b>${this._score}</b>`);
  }
}

// Różnica kątów w zakresie (-PI, PI)
function angleDiff(a, b) {
  let d = a - b;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
