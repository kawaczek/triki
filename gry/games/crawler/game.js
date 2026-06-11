// games/crawler/game.js — Triki Dungeon 2.0
// Pełne przepisanie pod grywalność na telefonie:
//  • JASNY loch — bez mgły wojny (tylko delikatna winieta na brzegach)
//  • sterowanie BEZPOŚREDNIE: przechył kapsla = ruch żabki (bez latającego kursora)
//  • AUTO-CELOWANIE: strzał sam namierza najbliższego wroga (celownik go podświetla)
//  • minimapka w rogu (pokoje, schody, skrzynie, wrogowie)
//  • piętro 1 = tutorial: dymki + mniej wrogów

import { clamp, rand, radialGlow, drawHintBubble } from '../../static/gameutils.js';

const TILE         = 48;     // rozmiar kafelka w px
const MAX_SPEED    = 0.21;   // maks. prędkość żabki px/ms
const BULLET_SPEED = 0.45;   // prędkość pocisku px/ms
const ENEMY_SPEED  = 0.055;  // bazowa prędkość wrogów
const AIM_RANGE    = 360;    // zasięg auto-celowania px
const SHOT_CD      = 230;    // cooldown strzału ms

const ENEMY_TYPES = [
  { name: 'Nietoperz', emoji: '🦇', hp: 1, speedMult: 1.3, color: '#ec4899', score: 10 },
  { name: 'Pająk',     emoji: '🕷️', hp: 2, speedMult: 0.9, color: '#ef4444', score: 20 },
  { name: 'Szkielet',  emoji: '💀', hp: 3, speedMult: 0.7, color: '#a855f7', score: 30 },
];

export default class DungeonGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas;
    this.ctx    = ctx;
    this.triki  = triki;
    this.emit   = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;
    this._mx = 0.5; this._my = 0.5;
    this._keys = {};

    this.level = 1;
    this.score = 0;
    this.coins = 0;
    this.kills = 0;
    this.hp = 3;
    this.maxHp = 3;
    this.invulnTime = 0;
    this._shotCd = 0;

    this.mapW = 18;
    this.mapH = 18;
    this.map = [];
    this.player = { x: 0, y: 0, r: 14 };
    this.lastDir = { x: 1, y: 0 };  // kierunek strzału awaryjnego
    this.bullets = [];
    this.enemies = [];
    this.particles = [];
    this.items = [];
    this.stairs = { x: 0, y: 0 };

    this.camX = 0;
    this.camY = 0;
    this.shake = 0;

    // loch od razu — drawIdle() może rysować przed start()
    this.generateDungeonLevel();
  }

  _mode() {
    return (typeof localStorage !== 'undefined' && localStorage.getItem('ctrlmode_crawler')) || 'tilt';
  }

  start(playerProfile) {
    this.playerProfile = playerProfile;
    this.level = 1;
    this.score = 0;
    this.coins = 0;
    this.kills = 0;
    this.hp = 3;
    this.invulnTime = 0;
    this._shotCd = 0;
    this.bullets = [];
    this.particles = [];
    this.shake = 0;
    this.lastDir = { x: 1, y: 0 };

    this.generateDungeonLevel();
    this.running = true;
    this._emitStats();
  }

  // ── generowanie lochu (losowe pokoje + korytarze) ────────
  generateDungeonLevel() {
    this.enemies = [];
    this.items = [];
    this.bullets = [];

    this.map = [];
    for (let y = 0; y < this.mapH; y++) {
      this.map[y] = [];
      for (let x = 0; x < this.mapW; x++) this.map[y][x] = 1; // 1 = ściana
    }

    const rooms = [];
    const roomCount = Math.floor(Math.random() * 3) + 4; // 4-6 pokoi
    for (let i = 0; i < roomCount; i++) {
      const rw = Math.floor(Math.random() * 4) + 4;
      const rh = Math.floor(Math.random() * 4) + 4;
      const rx = Math.floor(Math.random() * (this.mapW - rw - 2)) + 1;
      const ry = Math.floor(Math.random() * (this.mapH - rh - 2)) + 1;
      rooms.push({ x: rx, y: ry, w: rw, h: rh, cx: rx + Math.floor(rw / 2), cy: ry + Math.floor(rh / 2) });
      for (let y = ry; y < ry + rh; y++)
        for (let x = rx; x < rx + rw; x++) this.map[y][x] = 0;
    }

    for (let i = 1; i < rooms.length; i++) {
      const r1 = rooms[i - 1], r2 = rooms[i];
      for (let x = Math.min(r1.cx, r2.cx); x <= Math.max(r1.cx, r2.cx); x++) this.map[r1.cy][x] = 0;
      for (let y = Math.min(r1.cy, r2.cy); y <= Math.max(r1.cy, r2.cy); y++) this.map[y][r2.cx] = 0;
    }

    const startRoom = rooms[0];
    this.player.x = (startRoom.cx + 0.5) * TILE;
    this.player.y = (startRoom.cy + 0.5) * TILE;

    const endRoom = rooms[rooms.length - 1];
    this.stairs.x = endRoom.cx;
    this.stairs.y = endRoom.cy;
    this.map[this.stairs.y][this.stairs.x] = 2; // schody

    // skrzynie
    for (let i = 1; i < rooms.length - 1; i++) {
      const room = rooms[i];
      if (Math.random() < 0.7) {
        const tx = room.x + Math.floor(Math.random() * (room.w - 2)) + 1;
        const ty = room.y + Math.floor(Math.random() * (room.h - 2)) + 1;
        if (this.map[ty][tx] === 0) this.map[ty][tx] = 3;
      }
    }

    // wrogowie (piętro 1 = tutorial: max 1 na pokój)
    for (let i = 1; i < rooms.length; i++) {
      const room = rooms[i];
      const spawnCount = this.level === 1
        ? 1
        : Math.floor(Math.random() * 2) + 1 + Math.floor(this.level / 2);
      for (let k = 0; k < spawnCount; k++) {
        const tx = room.x + Math.floor(Math.random() * room.w);
        const ty = room.y + Math.floor(Math.random() * room.h);
        if (this.map[ty] && this.map[ty][tx] === 0) {
          const type = ENEMY_TYPES[Math.floor(Math.random() * Math.min(ENEMY_TYPES.length, this.level))];
          this.enemies.push({
            x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, r: 12,
            hp: type.hp, maxHp: type.hp,
            speed: ENEMY_SPEED * type.speedMult * (1 + this.level * 0.05),
            emoji: type.emoji, color: type.color, scoreValue: type.score,
            flash: 0,
          });
        }
      }
    }

    this.camX = this.player.x - this.W / 2;
    this.camY = this.player.y - this.H / 2;
  }

  resize(W, H) { this.W = W; this.H = H; }
  onMouseMove(nx, ny) { this._mx = nx; this._my = ny; }

  onClick() {
    if (this.triki.connected) this.shoot();          // tap ekranu przy BLE = auto-aim
    else this.shoot(this._pointerWorld());           // mysz/palec = strzał w kursor
  }

  onKeyDown(code) {
    this._keys[code] = true;
    if (code === 'Space') this.shoot();
  }
  onKeyUp(code) { this._keys[code] = false; }

  _pointerWorld() {
    return { x: this.camX + this._mx * this.W, y: this.camY + this._my * this.H };
  }

  _nearestEnemy(maxDist = AIM_RANGE) {
    let best = null, bd = maxDist;
    for (const e of this.enemies) {
      const d = Math.hypot(e.x - this.player.x, e.y - this.player.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  shoot(target = null) {
    if (!this.running || this.hp <= 0 || this._shotCd > 0) return;

    let dx, dy;
    if (target) {
      dx = target.x - this.player.x;
      dy = target.y - this.player.y;
    } else {
      const t = this._nearestEnemy();
      if (t) { dx = t.x - this.player.x; dy = t.y - this.player.y; }
      else   { dx = this.lastDir.x;      dy = this.lastDir.y; }
    }
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return;
    this._shotCd = SHOT_CD;

    this.bullets.push({
      x: this.player.x, y: this.player.y,
      vx: (dx / dist) * BULLET_SPEED,
      vy: (dy / dist) * BULLET_SPEED,
      r: 5, color: '#4ade80',
    });
    this.shake = Math.max(this.shake, 3);
    for (let i = 0; i < 4; i++) {
      this.spawnParticle(this.player.x, this.player.y, '#22c55e', {
        vx: (dx / dist) * 1.5 + (Math.random() - 0.5),
        vy: (dy / dist) * 1.5 + (Math.random() - 0.5),
        life: 180 + Math.random() * 150, size: 3 + Math.random() * 3,
      });
    }
  }

  spawnParticle(x, y, color, opts = {}) {
    const life = opts.life || 300 + Math.random() * 300;
    this.particles.push({
      x, y, color,
      vx: opts.vx ?? (Math.random() - 0.5) * 2,
      vy: opts.vy ?? (Math.random() - 0.5) * 2,
      size: opts.size || 4 + Math.random() * 4,
      life, maxLife: life,
      text: opts.text,
    });
  }

  spawnItemText(x, y, text, color) {
    this.particles.push({ x, y, color, text, vx: 0, vy: -0.8, size: 13, life: 800, maxLife: 800 });
  }

  checkWallCollision(x, y, r) {
    const minX = Math.floor((x - r) / TILE), maxX = Math.floor((x + r) / TILE);
    const minY = Math.floor((y - r) / TILE), maxY = Math.floor((y + r) / TILE);
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (ty < 0 || ty >= this.mapH || tx < 0 || tx >= this.mapW) return true;
        if (this.map[ty][tx] === 1) {
          const nx = Math.max(tx * TILE, Math.min(x, (tx + 1) * TILE));
          const ny = Math.max(ty * TILE, Math.min(y, (ty + 1) * TILE));
          if ((x - nx) ** 2 + (y - ny) ** 2 < r * r) return true;
        }
      }
    }
    return false;
  }

  // ── wejście ruchu: znormalizowany wektor [-1,1] ──────────
  _moveInput() {
    if (this.triki.connected) {
      // przechył (tilt ±15) lub machanie (swing °/s) — bez kursora!
      const swing = this._mode() === 'swing';
      const scale = swing ? 55 : 8;
      const h = -this.triki.GZ() / scale;
      const v =  this.triki.GX() / scale;
      const mag = Math.hypot(h, v);
      if (mag < 0.12) return { x: 0, y: 0 };           // martwa strefa
      const cap = Math.min(1, mag);
      return { x: (h / mag) * cap, y: (v / mag) * cap };
    }
    // klawiatura
    let kx = 0, ky = 0;
    if (this._keys.KeyW || this._keys.ArrowUp)    ky -= 1;
    if (this._keys.KeyS || this._keys.ArrowDown)  ky += 1;
    if (this._keys.KeyA || this._keys.ArrowLeft)  kx -= 1;
    if (this._keys.KeyD || this._keys.ArrowRight) kx += 1;
    if (kx || ky) { const m = Math.hypot(kx, ky); return { x: kx / m, y: ky / m }; }
    // mysz/palec: żabka idzie do wskaźnika (martwa strefa 26 px)
    const t = this._pointerWorld();
    const dx = t.x - this.player.x, dy = t.y - this.player.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 26) return { x: 0, y: 0 };
    const f = Math.min(1, dist / 140);
    return { x: (dx / dist) * f, y: (dy / dist) * f };
  }

  update(dt) {
    if (!this.running) return;

    if (this.triki.connected && this.triki.consumeClick()) this.shoot();
    if (this.invulnTime > 0) this.invulnTime -= dt;
    if (this._shotCd > 0) this._shotCd -= dt;
    if (this.shake > 0) { this.shake -= dt * 0.1; if (this.shake < 0) this.shake = 0; }

    // 1. ruch żabki
    const mv = this._moveInput();
    if (mv.x || mv.y) {
      const vx = mv.x * MAX_SPEED * dt;
      const vy = mv.y * MAX_SPEED * dt;
      const oldX = this.player.x;
      this.player.x += vx;
      if (this.checkWallCollision(this.player.x, this.player.y, this.player.r)) this.player.x = oldX;
      const oldY = this.player.y;
      this.player.y += vy;
      if (this.checkWallCollision(this.player.x, this.player.y, this.player.r)) this.player.y = oldY;
      const m = Math.hypot(mv.x, mv.y);
      this.lastDir = { x: mv.x / m, y: mv.y / m };
    }

    // 2. interakcje z kafelkami
    const pTileX = Math.floor(this.player.x / TILE);
    const pTileY = Math.floor(this.player.y / TILE);
    if (pTileX >= 0 && pTileX < this.mapW && pTileY >= 0 && pTileY < this.mapH) {
      const tile = this.map[pTileY][pTileX];
      if (tile === 2) {
        this.levelUp();
      } else if (tile === 3) {
        this.map[pTileY][pTileX] = 0;
        this.shake = 8;
        if (Math.random() < 0.2 && this.hp < this.maxHp) {
          this.hp++;
          this.score += 50;
          this.spawnItemText(this.player.x, this.player.y, '❤️ HP +1', '#ef4444');
        } else {
          const gold = Math.floor(Math.random() * 15) + 10;
          this.coins += gold;
          this.score += gold * 2;
          this.spawnItemText(this.player.x, this.player.y, `🪙 +${gold}`, '#fbbf24');
        }
        for (let i = 0; i < 12; i++) {
          this.spawnParticle((pTileX + 0.5) * TILE, (pTileY + 0.5) * TILE, '#f59e0b', {
            vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4,
          });
        }
        this._emitStats();
      }
    }

    // 3. pociski
    this.bullets.forEach(b => { b.x += b.vx * dt; b.y += b.vy * dt; });
    this.bullets = this.bullets.filter(b => {
      if (this.checkWallCollision(b.x, b.y, b.r)) {
        for (let i = 0; i < 3; i++) this.spawnParticle(b.x, b.y, '#94a3b8', { size: 2 + Math.random() * 2 });
        return false;
      }
      return true;
    });

    // 4. wrogowie: AI + kolizja z graczem
    this.enemies.forEach(e => {
      if (e.flash > 0) e.flash -= dt;
      const dx = this.player.x - e.x, dy = this.player.y - e.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 300) {
        const a = Math.atan2(dy, dx);
        const oldEx = e.x;
        e.x += Math.cos(a) * e.speed * dt;
        if (this.checkWallCollision(e.x, e.y, e.r)) e.x = oldEx;
        const oldEy = e.y;
        e.y += Math.sin(a) * e.speed * dt;
        if (this.checkWallCollision(e.x, e.y, e.r)) e.y = oldEy;
      }
      if (dist < e.r + this.player.r && this.invulnTime <= 0 && this.hp > 0) {
        this.hp--;
        this.invulnTime = 1200;
        this.shake = 15;
        for (let i = 0; i < 10; i++) {
          this.spawnParticle(this.player.x, this.player.y, '#ef4444', {
            vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6,
          });
        }
        this._emitStats();
        if (this.hp <= 0) this.gameOver();
      }
    });
    if (!this.running) return;

    // 5. pociski vs wrogowie
    this.bullets = this.bullets.filter(b => {
      let hit = false;
      this.enemies.forEach(e => {
        if (hit) return;
        if (Math.hypot(b.x - e.x, b.y - e.y) < b.r + e.r) {
          hit = true;
          e.hp--;
          e.flash = 120;
          e.x += b.vx * 12; e.y += b.vy * 12; // knockback
          for (let i = 0; i < 6; i++) {
            this.spawnParticle(b.x, b.y, e.color, {
              vx: b.vx * 0.3 + (Math.random() - 0.5) * 2,
              vy: b.vy * 0.3 + (Math.random() - 0.5) * 2,
            });
          }
        }
      });
      return !hit;
    });

    // 6. martwi wrogowie → punkty + dropy
    this.enemies = this.enemies.filter(e => {
      if (e.hp <= 0) {
        this.kills++;
        this.score += e.scoreValue;
        for (let i = 0; i < 15; i++) {
          this.spawnParticle(e.x, e.y, e.color, {
            vx: (Math.random() - 0.5) * 5, vy: (Math.random() - 0.5) * 5,
            size: 3 + Math.random() * 4, life: 400 + Math.random() * 300,
          });
        }
        const drop = Math.random();
        if (drop < 0.1 && this.hp < this.maxHp) {
          this.items.push({ x: e.x, y: e.y, type: 'heart', color: '#ef4444', emoji: '❤️', r: 10 });
        } else if (drop < 0.8) {
          this.items.push({ x: e.x, y: e.y, type: 'coin', color: '#fbbf24', emoji: '🪙', r: 8 });
        }
        this._emitStats();
        return false;
      }
      return true;
    });

    // 7. zbieranie przedmiotów
    this.items = this.items.filter(item => {
      if (Math.hypot(this.player.x - item.x, this.player.y - item.y) < this.player.r + item.r) {
        if (item.type === 'coin') {
          this.coins++;
          this.score += 15;
          this.spawnItemText(item.x, item.y, '+15', '#fbbf24');
        } else {
          this.hp = Math.min(this.maxHp, this.hp + 1);
          this.spawnItemText(item.x, item.y, '❤️ HP +1', '#ef4444');
        }
        for (let i = 0; i < 8; i++) this.spawnParticle(item.x, item.y, item.color, { size: 2 + Math.random() * 3 });
        this._emitStats();
        return false;
      }
      return true;
    });

    // 8. cząsteczki
    this.particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.life -= dt; });
    this.particles = this.particles.filter(p => p.life > 0);

    // 9. kamera
    this.camX += (this.player.x - this.W / 2 - this.camX) * 0.1;
    this.camY += (this.player.y - this.H / 2 - this.camY) * 0.1;
    this.camX = clamp(this.camX, -80, this.mapW * TILE - this.W + 80);
    this.camY = clamp(this.camY, -80, this.mapH * TILE - this.H + 80);
  }

  levelUp() {
    this.level++;
    this.score += 200;
    this.shake = 10;
    this.spawnItemText(this.player.x, this.player.y, `PIĘTRO ${this.level}! 🪜`, '#60a5fa');
    this.generateDungeonLevel();
    this._emitStats();
  }

  gameOver() {
    this.running = false;
    this.emit('end', { score: this.score });
  }

  // ── rysowanie ────────────────────────────────────────────
  draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    ctx.save();
    ctx.translate(sx - this.camX, sy - this.camY);

    // 1. kafelki — jasna, czytelna paleta
    const minX = Math.max(0, Math.floor(this.camX / TILE));
    const maxX = Math.min(this.mapW - 1, Math.floor((this.camX + W) / TILE));
    const minY = Math.max(0, Math.floor(this.camY / TILE));
    const maxY = Math.min(this.mapH - 1, Math.floor((this.camY + H) / TILE));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const tile = this.map[y][x];
        const tx = x * TILE, ty = y * TILE;
        if (tile === 1) {
          // ściana: jasny granat z górnym rozświetleniem
          ctx.fillStyle = '#3f4c7d';
          ctx.fillRect(tx, ty, TILE, TILE);
          ctx.fillStyle = '#5b6ba8';
          ctx.fillRect(tx, ty, TILE, TILE * 0.22);
          ctx.strokeStyle = 'rgba(140,160,230,0.35)';
          ctx.lineWidth = 1;
          ctx.strokeRect(tx + 0.5, ty + 0.5, TILE - 1, TILE - 1);
        } else {
          // podłoga: czytelny, jaśniejszy granat z siatką
          ctx.fillStyle = '#232c4e';
          ctx.fillRect(tx, ty, TILE, TILE);
          ctx.strokeStyle = 'rgba(255,255,255,0.05)';
          ctx.strokeRect(tx, ty, TILE, TILE);

          if (tile === 2) { // schody
            radialGlow(ctx, tx + TILE/2, ty + TILE/2, TILE * 0.9, '#3b82f6', 0.4);
            ctx.fillStyle = '#1d4ed8';
            ctx.beginPath();
            ctx.arc(tx + TILE/2, ty + TILE/2, TILE/3, 0, Math.PI*2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = '18px Outfit, sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('🪜', tx + TILE/2, ty + TILE/2);
          } else if (tile === 3) { // skrzynia
            radialGlow(ctx, tx + TILE/2, ty + TILE/2, TILE * 0.7, '#f59e0b', 0.25);
            ctx.fillStyle = '#92610e';
            ctx.beginPath();
            ctx.roundRect(tx + TILE*0.2, ty + TILE*0.25, TILE*0.6, TILE*0.5, 5);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = '16px Outfit, sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('📦', tx + TILE/2, ty + TILE/2);
          }
        }
      }
    }

    // 2. przedmioty
    this.items.forEach(item => {
      radialGlow(ctx, item.x, item.y, item.r * 2.5, item.color, 0.25);
      ctx.font = '15px Outfit, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(item.emoji, item.x, item.y);
    });

    // 3. wrogowie (celownik auto-aim tylko przy sterowaniu kapslem/klawiaturą)
    const aimTarget = this.triki.connected ? this._nearestEnemy() : null;
    this.enemies.forEach(e => {
      if (e.flash > 0 && Math.floor(e.flash / 30) % 2 === 0) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        radialGlow(ctx, e.x, e.y + 4, e.r * 1.4, '#000000', 0.3);
        ctx.font = `${e.r * 1.8}px Outfit, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(e.emoji, e.x, e.y);
        if (e.hp < e.maxHp) {
          const bw = e.r * 2;
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(e.x - bw/2, e.y - e.r - 8, bw, 3);
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(e.x - bw/2, e.y - e.r - 8, bw * (e.hp / e.maxHp), 3);
        }
      }
      // celownik auto-aim na najbliższym wrogu
      if (e === aimTarget) {
        ctx.save();
        ctx.strokeStyle = '#f87171';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r + 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    });

    // 4. pociski
    this.bullets.forEach(b => {
      radialGlow(ctx, b.x, b.y, b.r * 3, b.color, 0.4);
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    });

    // 5. cząsteczki
    this.particles.forEach(p => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      if (p.text) {
        ctx.font = `bold ${p.size}px Outfit, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(p.text, p.x, p.y);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });

    // 6. żabka
    ctx.save();
    if (this.invulnTime > 0 && Math.floor(this.invulnTime / 80) % 2 === 0) ctx.globalAlpha = 0.35;
    radialGlow(ctx, this.player.x, this.player.y + 4, this.player.r * 1.5, '#000000', 0.3);
    radialGlow(ctx, this.player.x, this.player.y, this.player.r * 2.6, '#22c55e', 0.18);
    ctx.font = '26px Outfit, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🐸', this.player.x, this.player.y);
    ctx.restore();

    ctx.restore(); // koniec transformacji kamery

    // 7. delikatna winieta zamiast mgły wojny (czytelność > klimat)
    const vg = ctx.createRadialGradient(W/2, H/2, Math.min(W, H) * 0.45, W/2, H/2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(5,8,20,0.5)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // 8. minimapka (prawy górny róg)
    this._drawMinimap(ctx, W);

    // 9. tutorial na piętrze 1
    if (this.level === 1 && this.running) {
      const psX = this.player.x - this.camX;
      const psY = this.player.y - this.camY;
      const hints = this.triki.connected
        ? ['🎮 Przechylaj kapsel = ruch żabki', '🔴 Guzik = strzał (sam celuje!)', '🪜 Znajdź schody w dół']
        : ['🖱️ Żabka idzie za kursorem / palcem', '👆 Klik = strzał', '🪜 Znajdź schody w dół'];
      let hy = psY - 56 - (hints.length - 1) * 30;
      if (hy < 26) hy = 26;
      hints.forEach((t, i) => drawHintBubble(ctx, psX, hy + i * 30, t));
    }
  }

  _drawMinimap(ctx, W) {
    const mmSize = 104;
    const pad = 10;
    const mx = W - mmSize - pad, my = pad;
    const s = mmSize / (this.mapW * TILE); // skala świat → minimapka

    ctx.save();
    ctx.fillStyle = 'rgba(8, 10, 22, 0.72)';
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(mx - 3, my - 3, mmSize + 6, mmSize + 6, 8);
    ctx.fill();
    ctx.stroke();

    const cell = TILE * s;
    for (let y = 0; y < this.mapH; y++) {
      for (let x = 0; x < this.mapW; x++) {
        const t = this.map[y][x];
        if (t === 1) continue; // ściany = tło
        ctx.fillStyle =
          t === 2 ? '#3b82f6' :
          t === 3 ? '#f59e0b' : 'rgba(255,255,255,0.30)';
        ctx.fillRect(mx + x * cell, my + y * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }
    // wrogowie
    ctx.fillStyle = '#ef4444';
    this.enemies.forEach(e => {
      ctx.fillRect(mx + e.x * s - 1.5, my + e.y * s - 1.5, 3, 3);
    });
    // żabka
    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.arc(mx + this.player.x * s, my + this.player.y * s, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawIdle() { this.draw(); }
  destroy()  { this.running = false; }

  _emitStats() {
    let hearts = '';
    for (let i = 0; i < this.maxHp; i++) hearts += i < this.hp ? '❤️' : '🖤';
    this.emit(
      'stats',
      `<span style="color:#ef4444">${hearts}</span> &nbsp;·&nbsp; ` +
        `🪙 <b>${this.coins}</b> &nbsp;·&nbsp; ` +
        `🪜 <b>${this.level}</b> &nbsp;·&nbsp; ` +
        `🏆 <b>${this.score}</b>`
    );
  }
}
