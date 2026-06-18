// games/atari/game.js — Atari Retro Invaders
// Klon klasyka z lat 80. stylizowany na konsolę Atari 2600 podłączoną do TV CRT.

class RetroSound {
  static init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  static playLaser() {
    this.init();
    if (!this.ctx) return;
    let osc = this.ctx.createOscillator();
    let gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(600, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.15);
  }
  static playExplosion() {
    this.init();
    if (!this.ctx) return;
    try {
      let bufferSize = this.ctx.sampleRate * 0.3;
      let buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      let data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      let noise = this.ctx.createBufferSource();
      noise.buffer = buffer;
      let filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(300, this.ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(30, this.ctx.currentTime + 0.3);
      let gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.3);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      noise.start();
    } catch (e) {}
  }
  static playHit() {
    this.init();
    if (!this.ctx) return;
    let osc = this.ctx.createOscillator();
    let gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(120, this.ctx.currentTime);
    osc.frequency.setValueAtTime(60, this.ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.2);
  }
}

export default class AtariGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas  = canvas;
    this.ctx     = ctx;
    this.triki   = triki;
    this.emit    = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;
    
    // Ustawienia ekranu gry (wewnątrz wirtualnego telewizora)
    this.tvX = 0;
    this.tvY = 0;
    this.tvW = 0;
    this.tvH = 0;

    this.initGameState();
  }

  drawRoundRect(ctx, x, y, w, h, r) {
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.rect(x, y, w, h);
    }
  }

  initGameState() {
    this.score = 0;
    this.playerX = 0.5; // pozycja [0..1] wewnątrz ekranu TV
    this.playerWidth = 0.08;
    this.bullets = [];   // {x, y, speed, isPlayer}
    this.invaders = [];  // {x, y, type, alive}
    this.invaderDirection = 1; // 1 = prawo, -1 = lewo
    this.invaderStepTime = 800; // ms na krok
    this.lastInvaderStep = 0;
    this.lives = 3;
    this.gameOver = false;
    this.gameWon = false;
    
    // tarcze osłonowe
    this.shields = []; // {x, y, hp}
    
    // Inicjalizacja obcych
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 6; col++) {
        this.invaders.push({
          x: 0.15 + col * 0.14,
          y: 0.15 + row * 0.12,
          type: row,
          alive: true
        });
      }
    }

    // Inicjalizacja tarcz
    for (let s = 0; s < 3; s++) {
      const sx = 0.22 + s * 0.28;
      for (let i = 0; i < 5; i++) {
        this.shields.push({
          x: sx + (i - 2) * 0.02,
          y: 0.72,
          hp: 3
        });
      }
    }
  }

  start(player) {
    this.player  = player;
    this.initGameState();
    this.running = true;
    RetroSound.init();
  }

  resize(W, H) {
    this.W = W;
    this.H = H;
    // Dopasowanie proporcji wirtualnego telewizora CRT
    this.tvW = W * 0.88;
    this.tvH = H * 0.62;
    this.tvX = (W - this.tvW) / 2;
    this.tvY = H * 0.06;
  }

  onMouseMove(nx, ny) {
    if (!this.triki.connected) {
      this.playerX = nx;
    }
  }

  onClick(nx, ny) {
    this.firePlayerBullet();
  }

  onKeyDown(code) {
    if (code === 'ArrowLeft') {
      this.playerX = Math.max(0.05, this.playerX - 0.05);
    } else if (code === 'ArrowRight') {
      this.playerX = Math.min(0.95, this.playerX + 0.05);
    } else if (code === 'Space') {
      this.firePlayerBullet();
    }
  }

  firePlayerBullet() {
    if (this.gameOver || this.gameWon || !this.running) return;
    // limit 2 pocisków na ekranie
    const playerBullets = this.bullets.filter(b => b.isPlayer);
    if (playerBullets.length >= 2) return;

    this.bullets.push({
      x: this.playerX,
      y: 0.82,
      speed: -0.6,
      isPlayer: true
    });
    RetroSound.playLaser();
  }

  update(dt) {
    if (!this.running) return;
    if (this.gameOver || this.gameWon) return;

    // ── Sterowanie przez BLE ────────────────────────────────
    if (this.triki.connected) {
      const tilt = -this.triki.GZ(); // przechylenie lewo/prawo
      if (Math.abs(tilt) > 1.2) {
        const speed = (tilt > 0 ? 1 : -1) * 0.0006 * Math.min(10, Math.abs(tilt)) * dt;
        this.playerX = Math.max(0.05, Math.min(0.95, this.playerX + speed));
      }
      
      if (this.triki.consumeClick()) {
        this.firePlayerBullet();
      }
    }

    // ── Ruch pocisków ───────────────────────────────────────
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.y += b.speed * (dt / 1000);
      
      // usunięcie z ekranu
      if (b.y < 0.05 || b.y > 0.88) {
        this.bullets.splice(i, 1);
        continue;
      }

      // kolizje z osłonami
      let hitShield = false;
      for (let s = 0; s < this.shields.length; s++) {
        const sh = this.shields[s];
        if (sh.hp > 0 && Math.abs(b.x - sh.x) < 0.025 && Math.abs(b.y - sh.y) < 0.025) {
          sh.hp--;
          this.bullets.splice(i, 1);
          hitShield = true;
          RetroSound.playHit();
          break;
        }
      }
      if (hitShield) continue;

      if (b.isPlayer) {
        // Kolizja pocisku gracza z obcymi
        let hitInvader = false;
        for (let inv of this.invaders) {
          if (inv.alive && Math.abs(b.x - inv.x) < 0.05 && Math.abs(b.y - inv.y) < 0.04) {
            inv.alive = false;
            this.bullets.splice(i, 1);
            hitInvader = true;
            this.score += (3 - inv.type) * 10;
            this.emit('stats', `WYNIK: <b>${this.score}</b> pkt | ŻYCIA: <b>${'❤️'.repeat(this.lives)}</b>`);
            RetroSound.playExplosion();
            break;
          }
        }
        if (hitInvader) {
          // sprawdź wygraną
          if (this.invaders.every(inv => !inv.alive)) {
            this.gameWon = true;
            this.emit('end', { score: this.score });
          }
          continue;
        }
      } else {
        // Kolizja pocisku obcego z graczem
        if (Math.abs(b.x - this.playerX) < 0.06 && Math.abs(b.y - 0.85) < 0.035) {
          this.bullets.splice(i, 1);
          this.lives--;
          RetroSound.playExplosion();
          this.emit('stats', `WYNIK: <b>${this.score}</b> pkt | ŻYCIA: <b>${'❤️'.repeat(this.lives)}</b>`);
          if (this.lives <= 0) {
            this.gameOver = true;
            this.emit('end', { score: this.score });
          }
          continue;
        }
      }
    }

    // ── Krok i ruch obcych ─────────────────────────────────
    this.lastInvaderStep += dt;
    if (this.lastInvaderStep >= this.invaderStepTime) {
      this.lastInvaderStep = 0;
      
      // Sprawdź czy obcy doszli do ściany
      let changeDir = false;
      for (let inv of this.invaders) {
        if (inv.alive) {
          const nextX = inv.x + this.invaderDirection * 0.03;
          if (nextX < 0.08 || nextX > 0.92) {
            changeDir = true;
            break;
          }
        }
      }

      if (changeDir) {
        this.invaderDirection = -this.invaderDirection;
        for (let inv of this.invaders) {
          if (inv.alive) {
            inv.y += 0.05;
            if (inv.y >= 0.78 && !this.gameOver) {
              this.gameOver = true;
              this.emit('end', { score: this.score });
              RetroSound.playExplosion();
              break;
            }
          }
        }
      } else {
        for (let inv of this.invaders) {
          if (inv.alive) {
            inv.x += this.invaderDirection * 0.035;
          }
        }
      }

      // Losowy strzał obcego
      const aliveInvaders = this.invaders.filter(inv => inv.alive);
      if (aliveInvaders.length > 0 && Math.random() < 0.35) {
        const shooter = aliveInvaders[Math.floor(Math.random() * aliveInvaders.length)];
        this.bullets.push({
          x: shooter.x,
          y: shooter.y + 0.04,
          speed: 0.32,
          isPlayer: false
        });
      }
    }
  }

  draw() {
    const { ctx, W, H, tvX, tvY, tvW, tvH } = this;
    ctx.fillStyle = '#060810';
    ctx.fillRect(0, 0, W, H);

    // ── Rysowanie obudowy telewizora CRT 📺 ────────────────
    ctx.save();
    ctx.fillStyle = '#1e1f29'; // obudowa TV
    ctx.beginPath();
    this.drawRoundRect(ctx, tvX - 12, tvY - 12, tvW + 24, tvH + 24, 18);
    ctx.fill();
    
    // drewniane boczki obudowy TV
    ctx.fillStyle = '#834c24';
    ctx.fillRect(tvX - 22, tvY - 12, 10, tvH + 24);
    ctx.fillRect(tvX + tvW + 12, tvY - 12, 10, tvH + 24);
    
    // Srebrne pokrętła po prawej stronie TV
    ctx.fillStyle = '#a1a1aa';
    ctx.beginPath();
    ctx.arc(tvX + tvW + 5, tvY + 30, 8, 0, Math.PI * 2);
    ctx.arc(tvX + tvW + 5, tvY + 60, 8, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();

    // ── Ekran CRT (wewnętrzny) ──
    ctx.save();
    // Clipowanie do wirtualnego ekranu
    ctx.beginPath();
    this.drawRoundRect(ctx, tvX, tvY, tvW, tvH, 10);
    ctx.clip();
    
    // Kineskopowy kolor tła (ciemny błękit/szary z poświatą)
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(tvX, tvY, tvW, tvH);

    if (this.gameOver) {
      // EKRAN KONIEC GRY
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 36px Outfit,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('GAME OVER', tvX + tvW/2, tvY + tvH/2 - 10);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '16px Outfit,sans-serif';
      ctx.fillText('Kliknij ekran lub przycisk aby spróbować', tvX + tvW/2, tvY + tvH/2 + 25);
    } else if (this.gameWon) {
      // EKRAN WYGRANEJ
      ctx.fillStyle = '#22c55e';
      ctx.font = 'bold 36px Outfit,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('YOU WIN!', tvX + tvW/2, tvY + tvH/2 - 10);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '16px Outfit,sans-serif';
      ctx.fillText('Znakomity wynik retro!', tvX + tvW/2, tvY + tvH/2 + 25);
    } else {
      // ── Gra ──
      // Gracz
      const px = tvX + this.playerX * tvW;
      const py = tvY + 0.85 * tvH;
      ctx.fillStyle = '#22c55e'; // zielony retro gracz
      ctx.fillRect(px - 16, py - 6, 32, 12);
      ctx.fillRect(px - 4, py - 14, 8, 8); // lufa

      // Obcy
      for (let inv of this.invaders) {
        if (inv.alive) {
          const ix = tvX + inv.x * tvW;
          const iy = tvY + inv.y * tvH;
          
          // Kolory Atari dla obcych
          const colors = ['#a855f7', '#3b82f6', '#f59e0b'];
          ctx.fillStyle = colors[inv.type % colors.length];
          
          // Pikselowe rysowanie obcego
          ctx.fillRect(ix - 12, iy - 8, 24, 16);
          // Oczy obcego
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(ix - 6, iy - 4, 3, 3);
          ctx.fillRect(ix + 3, iy - 4, 3, 3);
        }
      }

      // Pociski
      for (let b of this.bullets) {
        const bx = tvX + b.x * tvW;
        const by = tvY + b.y * tvH;
        ctx.fillStyle = b.isPlayer ? '#ffffff' : '#ef4444';
        ctx.fillRect(bx - 2, by - 5, 4, 10);
      }

      // Osłony
      for (let sh of this.shields) {
        if (sh.hp > 0) {
          const sx = tvX + sh.x * tvW;
          const sy = tvY + sh.y * tvH;
          const shieldColors = ['rgba(34,197,94,0.3)', 'rgba(34,197,94,0.6)', '#22c55e'];
          ctx.fillStyle = shieldColors[sh.hp - 1];
          ctx.fillRect(sx - 8, sy - 8, 16, 16);
        }
      }
    }

    // Linie skanowania CRT (co drugi piksel)
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = tvY; y < tvY + tvH; y += 3) {
      ctx.fillRect(tvX, y, tvW, 1.5);
    }
    
    // Odblask CRT (radial gradient)
    const grad = ctx.createRadialGradient(tvX + tvW/2, tvY + tvH/2, tvH/3, tvX + tvW/2, tvY + tvH/2, tvW/2);
    grad.addColorStop(0, 'rgba(255,255,255,0.03)');
    grad.addColorStop(1, 'rgba(0,0,0,0.32)');
    ctx.fillStyle = grad;
    ctx.fillRect(tvX, tvY, tvW, tvH);

    ctx.restore();

    // ── Rysowanie konsoli Atari 2600 pod TV 🕹️ ──
    const consY = tvY + tvH + 20;
    const consH = H - consY - 10;
    if (consH > 15) {
      ctx.save();
      // drewniana obudowa
      ctx.fillStyle = '#653c1f';
      ctx.fillRect(10, consY, W - 20, consH);
      
      // czarny żebrowany panel
      ctx.fillStyle = '#111';
      ctx.fillRect(25, consY + 4, W - 50, consH - 8);
      
      // kolorowy pasek retro (pomarańcz/czerwony/żółty)
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(25, consY + 6, W - 50, 3);
      
      // Logo Atari i napis 2600
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('ATARI 2600', W/2, consY + consH/2 + 2);
      ctx.restore();
    }
  }

  drawIdle() {
    this.draw();
  }

  destroy() {
    this.running = false;
  }
}
