// games/memory/game.js — Memory: Paruj Karty
// Plansza 4×4, 8 par emoji.
// Sterowanie: przechył GX/GZ → przesuń kursor (latch) · klik → odkryj kartę

import { clamp, drawGrid, radialGlow } from '../../static/gameutils.js';

const COLS = 4;
const ROWS = 4;
const TOTAL_CARDS = COLS * ROWS;   // 16
const EMOJIS = ['🐸', '🚀', '🎯', '🏆', '🌟', '💎', '🎲', '🎮']; // 8 par

const GAME_MS    = 90_000; // 90 sekund
const FLIP_DELAY = 1000;   // ms — czas przed zakryciem nietrafionych
const TRIG = 15;           // próg przechyłu [stopnie]
const REL  = 5;            // histereza latcha

// stany karty
const S_HIDDEN  = 0;
const S_FLIPPED = 1;
const S_MATCHED = 2;

export default class MemoryGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas  = canvas;
    this.ctx     = ctx;
    this.triki   = triki;
    this.emit    = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;

    // Pełny stan bezpieczny przed start()
    this.cards      = this._makeCards();
    this.curRow     = 0;
    this.curCol     = 0;
    this.flipped    = [];   // indeksy aktualnie odkrytych (max 2)
    this.matched    = 0;    // liczba dopasowanych par
    this.score      = 0;
    this.combo      = 0;    // kolejne trafienia z rzędu
    this.timeLeft   = GAME_MS;
    this._flipTimer = 0;    // odliczanie przed zakryciem nietrafionych
    this._checking  = false;// czekamy na zakrycie
    this._latchX    = false;
    this._latchZ    = false;
    this._pulseT    = 0;    // czas do animacji pulsowania kursora
    this._banner    = null;
    this._matchAnim = [];   // [{col,row,t}] krótka animacja dopasowania
  }

  // ─── inicjalizacja talii ─────────────────────────────────
  _makeCards() {
    const emojis = [...EMOJIS, ...EMOJIS]; // 16 kart
    // Fisher-Yates shuffle
    for (let i = emojis.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [emojis[i], emojis[j]] = [emojis[j], emojis[i]];
    }
    return emojis.map((emoji, idx) => ({
      emoji,
      state: S_HIDDEN,
      col: idx % COLS,
      row: Math.floor(idx / COLS),
    }));
  }

  // ─── start / lifecycle ──────────────────────────────────
  start(player) {
    this.player     = player;
    this.cards      = this._makeCards();
    this.curRow     = 0;
    this.curCol     = 0;
    this.flipped    = [];
    this.matched    = 0;
    this.score      = 0;
    this.combo      = 0;
    this.timeLeft   = GAME_MS;
    this._flipTimer = 0;
    this._checking  = false;
    this._latchX    = false;
    this._latchZ    = false;
    this._pulseT    = 0;
    this._banner    = null;
    this._matchAnim = [];
    this.running    = true;
    this._emitStats();
  }

  resize(W, H) { this.W = W; this.H = H; }
  destroy()    { this.running = false; }
  drawIdle()   { this.draw(); }

  // ─── update ─────────────────────────────────────────────
  update(dt) {
    if (!this.running) return;

    this._pulseT += dt;
    if (this._banner) { this._banner.t -= dt; if (this._banner.t <= 0) this._banner = null; }

    // Animacje dopasowań
    this._matchAnim = this._matchAnim.filter(a => { a.t -= dt; return a.t > 0; });

    // Odliczanie czasu gry
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this._endGame();
      return;
    }

    // Odliczanie przed zakryciem nietrafionych
    if (this._checking) {
      this._flipTimer -= dt;
      if (this._flipTimer <= 0) {
        // zakryj nietrafionych
        this.flipped.forEach(i => {
          if (this.cards[i].state === S_FLIPPED) {
            this.cards[i].state = S_HIDDEN;
          }
        });
        this.flipped   = [];
        this._checking = false;
        this.combo     = 0; // reset combo przy błędzie
      }
      return; // blokuj input podczas oczekiwania
    }

    // Ruch kursora
    this._moveCursor(dt);

    // Klik = odkryj kartę
    if (this.triki.consumeClick()) {
      this._tryFlip();
    }
  }

  _moveCursor(dt) {
    if (!this.triki.connected) return;

    const gx = this.triki.GX(0);   // dół=+
    const gz = -this.triki.GZ(0);  // prawo=+

    // Latch osi X (wiersze)
    if (Math.abs(gx) >= TRIG) {
      if (!this._latchX) {
        this._latchX = true;
        this.curRow  = (this.curRow + (gx > 0 ? 1 : -1) + ROWS) % ROWS;
      }
    } else if (Math.abs(gx) < REL) {
      this._latchX = false;
    }

    // Latch osi Z (kolumny)
    if (Math.abs(gz) >= TRIG) {
      if (!this._latchZ) {
        this._latchZ = true;
        this.curCol  = (this.curCol + (gz > 0 ? 1 : -1) + COLS) % COLS;
      }
    } else if (Math.abs(gz) < REL) {
      this._latchZ = false;
    }
  }

  _tryFlip() {
    const idx = this.curRow * COLS + this.curCol;
    const card = this.cards[idx];

    // Nie odkrywaj już dopasowanych ani już odkrytych
    if (card.state !== S_HIDDEN) return;
    if (this.flipped.length >= 2) return;

    card.state = S_FLIPPED;
    this.flipped.push(idx);

    if (this.flipped.length === 2) {
      this._checkMatch();
    }
  }

  _checkMatch() {
    const [a, b] = this.flipped;
    const ca = this.cards[a], cb = this.cards[b];

    if (ca.emoji === cb.emoji) {
      // Trafienie!
      ca.state = S_MATCHED;
      cb.state = S_MATCHED;
      this.matched++;
      this.combo++;

      const multiplier = clamp(this.combo, 1, 4);
      const pts = 10 * multiplier;
      this.score += pts;

      if (navigator.vibrate) navigator.vibrate(40);

      // Animacja pary
      [a, b].forEach(i => {
        this._matchAnim.push({ col: this.cards[i].col, row: this.cards[i].row, t: 600 });
      });

      const comboLabel = multiplier > 1 ? ` ×${multiplier} COMBO!` : '';
      this._banner = { text: `+${pts}${comboLabel}`, t: 700, color: '#22c55e' };

      this.flipped = [];
      this._emitStats();

      // Koniec gry gdy wszystkie pary odkryte
      if (this.matched === TOTAL_CARDS / 2) {
        // bonus za szybkość: 1 pkt za każdą pełną sekundę pozostałą
        const speedBonus = Math.floor(this.timeLeft / 1000);
        this.score += speedBonus;
        this._banner = { text: `Gratulacje! +${speedBonus} bonus!`, t: 2000, color: '#eab308' };
        this._endGame(700);
        return;
      }
    } else {
      // Błąd — zakryj po FLIP_DELAY
      if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
      this._checking  = true;
      this._flipTimer = FLIP_DELAY;
    }
  }

  _endGame(delay = 0) {
    if (delay > 0) {
      setTimeout(() => {
        this.running = false;
        this.emit('end', { score: this.score });
        this._emitStats();
      }, delay);
    } else {
      this.running = false;
      this.emit('end', { score: this.score });
    }
  }

  // ─── draw ────────────────────────────────────────────────
  draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);
    drawGrid(ctx, W, H, 0.025);

    const hudH   = Math.max(36, H * 0.07);
    const margin = Math.min(W, H - hudH) * 0.025;
    const gridW  = W - margin * 2;
    const gridH  = H - hudH - margin * 2;
    const cw     = gridW / COLS;
    const ch     = gridH / ROWS;
    const pad    = Math.min(cw, ch) * 0.06;
    const r      = Math.min(cw, ch) * 0.12;
    const ox     = margin;
    const oy     = hudH + margin;

    // HUD
    this._drawHUD(hudH);

    // Karty
    this.cards.forEach(card => {
      const px = ox + card.col * cw + pad;
      const py = oy + card.row * ch + pad;
      const pw = cw - pad * 2;
      const ph = ch - pad * 2;

      ctx.save();

      if (card.state === S_HIDDEN) {
        this._drawCardBack(ctx, px, py, pw, ph, r);
      } else if (card.state === S_FLIPPED) {
        this._drawCardFront(ctx, px, py, pw, ph, r, card.emoji, false);
      } else {
        // MATCHED
        this._drawCardFront(ctx, px, py, pw, ph, r, card.emoji, true);
      }

      ctx.restore();
    });

    // Animacje dopasowań (zielony błysk)
    this._matchAnim.forEach(a => {
      const px = ox + a.col * cw + pad;
      const py = oy + a.row * ch + pad;
      const pw = cw - pad * 2;
      const ph = ch - pad * 2;
      const frac = a.t / 600;
      ctx.save();
      ctx.globalAlpha  = frac * 0.6;
      ctx.strokeStyle  = '#22c55e';
      ctx.lineWidth    = 4;
      ctx.shadowColor  = '#22c55e';
      ctx.shadowBlur   = 20 * frac;
      ctx.beginPath();
      ctx.roundRect(px, py, pw, ph, r);
      ctx.stroke();
      ctx.restore();
    });

    // Kursor — pulsująca żółta ramka
    this._drawCursor(ctx, ox, oy, cw, ch, pad, r);

    // Baner
    if (this._banner) {
      const a = Math.min(1, this._banner.t / 250);
      ctx.save();
      ctx.globalAlpha  = a;
      ctx.fillStyle    = this._banner.color || '#ffffff';
      ctx.shadowColor  = this._banner.color || '#ffffff';
      ctx.shadowBlur   = 24;
      ctx.font         = `800 ${Math.round(W / 9)}px Outfit,sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this._banner.text, W / 2, (H - hudH) / 2 + hudH);
      ctx.restore();
    }
  }

  _drawCardBack(ctx, x, y, w, h, r) {
    // Ciemny gradient z wzorem geometrycznym
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, '#1e1b4b');
    grad.addColorStop(1, '#312e81');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();

    // Wzór: siatka kółek
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth   = 1;
    const step = Math.min(w, h) * 0.22;
    for (let dx = step / 2; dx < w; dx += step) {
      for (let dy = step / 2; dy < h; dy += step) {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, step * 0.35, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Znak zapytania
    ctx.fillStyle    = 'rgba(168,85,247,0.55)';
    ctx.font         = `800 ${Math.min(w, h) * 0.5}px Outfit,sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', x + w / 2, y + h / 2);
  }

  _drawCardFront(ctx, x, y, w, h, r, emoji, matched) {
    // Jasne tło
    const bg = matched ? '#1e3a2e' : '#f8fafc';
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();

    if (matched) {
      // Zielona obwódka
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth   = 2.5;
      ctx.beginPath();
      ctx.roundRect(x + 1, y + 1, w - 2, h - 2, r);
      ctx.stroke();
    }

    // Emoji
    ctx.font         = `${Math.min(w, h) * 0.55}px Outfit,sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, x + w / 2, y + h / 2);
  }

  _drawCursor(ctx, ox, oy, cw, ch, pad, r) {
    const pulse  = Math.sin(this._pulseT / 220) * 0.5 + 0.5; // 0..1
    const alpha  = 0.6 + pulse * 0.4;
    const blur   = 8 + pulse * 14;
    const x  = ox + this.curCol * cw + pad;
    const y  = oy + this.curRow * ch + pad;
    const pw = cw - pad * 2;
    const ph = ch - pad * 2;

    ctx.save();
    ctx.globalAlpha  = alpha;
    ctx.strokeStyle  = '#eab308';
    ctx.lineWidth    = 3;
    ctx.shadowColor  = '#eab308';
    ctx.shadowBlur   = blur;
    ctx.beginPath();
    ctx.roundRect(x, y, pw, ph, r);
    ctx.stroke();

    // Narożniki kursora (dekoracja)
    const cs = Math.min(pw, ph) * 0.2;
    ctx.lineWidth = 3;
    const corners = [
      [x, y, cs, 0, cs, 0, 0, cs],
      [x + pw, y, -cs, 0, 0, 0, 0, cs],
      [x, y + ph, cs, 0, 0, 0, 0, -cs],
      [x + pw, y + ph, -cs, 0, 0, 0, 0, -cs],
    ];
    ctx.beginPath();
    corners.forEach(([cx, cy, dx1, dy1, dx2, dy2, dx3, dy3]) => {
      ctx.moveTo(cx + dx1, cy + dy1);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + dx3, cy + dy3);
    });
    ctx.stroke();

    ctx.restore();
  }

  _drawHUD(hudH) {
    const { ctx, W } = this;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, W, hudH);

    const fy = hudH / 2;
    ctx.font         = `600 ${Math.round(hudH * 0.48)}px Outfit,sans-serif`;
    ctx.textBaseline = 'middle';

    // Czas
    const sec  = Math.ceil(this.timeLeft / 1000);
    const tCol = sec > 30 ? '#22c55e' : sec > 10 ? '#eab308' : '#ef4444';
    ctx.fillStyle = tCol;
    ctx.textAlign = 'left';
    ctx.fillText(`⏱ ${sec}s`, 10, fy);

    // Wynik środek
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.textAlign = 'center';
    ctx.fillText(`${this.score} pkt`, W / 2, fy);

    // Pary prawo
    ctx.textAlign = 'right';
    ctx.fillText(`${this.matched}/${TOTAL_CARDS / 2} par`, W - 10, fy);

    // Pasek czasu (cieniutki na dole HUD)
    const frac = clamp(this.timeLeft / GAME_MS, 0, 1);
    ctx.fillStyle = tCol;
    ctx.shadowColor = tCol;
    ctx.shadowBlur  = 6;
    ctx.fillRect(0, hudH - 3, W * frac, 3);

    // Combo badge
    if (this.combo >= 2) {
      const mult = clamp(this.combo, 1, 4);
      ctx.shadowBlur  = 0;
      ctx.fillStyle   = '#eab308';
      ctx.font        = `800 ${Math.round(hudH * 0.4)}px Outfit,sans-serif`;
      ctx.textAlign   = 'center';
      ctx.fillText(`×${mult} COMBO`, W / 2, hudH - Math.round(hudH * 0.28));
    }

    ctx.restore();
  }

  _emitStats() {
    const sec   = Math.ceil(this.timeLeft / 1000);
    const mult  = clamp(this.combo, 1, 4);
    const combo = this.combo >= 2 ? ` &nbsp;·&nbsp; <span style="color:#eab308">×${mult} COMBO</span>` : '';
    this.emit('stats',
      `⏱ <b>${sec}s</b> &nbsp;·&nbsp; 🃏 <b>${this.matched}</b>/${TOTAL_CARDS / 2} par &nbsp;·&nbsp; <b>${this.score}</b> pkt${combo}`
    );
  }
}
