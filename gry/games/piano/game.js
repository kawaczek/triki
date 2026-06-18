// games/piano/game.js — Piano Triki
// Przechylaj kapsel L/R żeby wybrać nutę, kliknij żeby zagrać.
// Klawiatura C-dur (C4–G5, 13 białych + 9 czarnych klawiszy).
// Rozpoznaje proste melodie i wyświetla ich nazwy.

import { clamp } from '../../static/gameutils.js';

// --- Skala C-dur C4..G5 (13 białych klawiszy = stopnie 0..12) ---
// n=0 → C4 (261.63 Hz), każdy półton = *2^(1/12)
// Białe klawisze: C D E F G A B C D E F G (stopnie chromatyczne)
const WHITE_SEMITONES = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19]; // 12 białych = indeksy 0..11
const WHITE_NAMES     = ['C','D','E','F','G','A','B','C','D','E','F','G'];
const NUM_WHITE = 12;  // klawisze 0..11

// Czarne klawisze (C#/Db): między odpowiednimi białymi
// Para [leftWhiteIdx, semitone, name]
const BLACK_KEYS = [
  [0,  1,  'C#'], // między C i D
  [1,  3,  'D#'], // między D i E
  [3,  6,  'F#'], // między F i G
  [4,  8,  'G#'], // między G i A
  [5,  10, 'A#'], // między A i B
  [7,  13, 'C#5'],// między C5 i D5
  [8,  15, 'D#5'],// między D5 i E5
  [10, 18, 'F#5'],// między F5 i G5
  [11, 20, 'G#5'],// między G5 i A5 — wyjście poza zakres, ale brzmi OK
];

// Melodie do rozpoznania: sekwencja stopni białych klawiszy (indeks 0..11)
const MELODIES = [
  { name: 'Wlazł Kotek',    notes: [4,4,3,3,4,3,2,2,1,2,3,4,0] },
  { name: 'Happy Birthday',  notes: [0,0,1,0,3,2, 0,0,1,0,4,3] },
  { name: 'Marsz Weselny',   notes: [0,0,0,4,3,3,3,2,2,2,4,0,0] },
  { name: 'Oda do Radości',  notes: [2,2,3,4,4,3,2,1,0,0,1,2,2,1,1] },
  { name: 'Jingle Bells',    notes: [2,2,2, 2,2,2, 2,4,0,1,2] },
  { name: 'C-durowa gama',   notes: [0,1,2,3,4,5,6,7] },
];

// Kolory klawiszy wg nazwy nuty (kolorowa klawiatura)
const NOTE_COLORS = {
  'C':'#a855f7','D':'#3b82f6','E':'#22c55e','F':'#f59e0b',
  'G':'#ef4444','A':'#06b6d4','B':'#ec4899',
  'C#':'#8b5cf6','D#':'#2563eb','F#':'#16a34a','G#':'#d97706','A#':'#db2777',
  'C#5':'#8b5cf6','D#5':'#2563eb','F#5':'#16a34a','G#5':'#d97706',
};

export default class PianoGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas  = canvas;
    this.ctx     = ctx;
    this.triki   = triki;
    this.emit    = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;

    // Web Audio
    this._audioCtx   = null;
    this._activeKeys = new Map(); // noteIdx → {osc, gain, pressT}

    // Kursor (float, 0..NUM_WHITE-1)
    this._cursor  = NUM_WHITE / 2;
    this._cursorI = Math.round(this._cursor); // zaokrąglony = aktywny klawisz

    // Animacja kliknięcia klawiszy
    this._pressAnim = new Float32Array(NUM_WHITE); // 0..1, zaniku

    // Historia ostatnich 8 nut (indeksy 0..11)
    this._history = [];

    // Rozpoznana melodia
    this._melodyBanner = null; // { text, t }

    // Klawiatura (mysz / klawiatura)
    this._mx    = 0.5;
    this._keys  = {};
    this._kDir  = 0; // -1/0/+1 (strzałki)

    // Czas
    this._t = 0;
  }

  // ─── Audio ───────────────────────────────────────────────
  _ensureAudio() {
    if (this._audioCtx) return;
    try { this._audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (_) {}
  }

  _noteFreq(semitone) {
    return 261.63 * Math.pow(2, semitone / 12); // C4 = 261.63 Hz
  }

  _playNote(whiteIdx) {
    this._ensureAudio();
    if (!this._audioCtx) return;
    const semi = WHITE_SEMITONES[whiteIdx];
    const freq  = this._noteFreq(semi);
    const ctx   = this._audioCtx;
    const now   = ctx.currentTime;

    // Stop previous instance of same key
    if (this._activeKeys.has(whiteIdx)) {
      const old = this._activeKeys.get(whiteIdx);
      try { old.gain.gain.setTargetAtTime(0, now, 0.02); old.osc.stop(now + 0.1); } catch (_) {}
    }

    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    osc.frequency.value = freq;

    // Envelope: attack 0.02s, sustain at 0.5, release at 0.3s → off ~0.5s total
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.5, now + 0.02);
    gain.gain.setTargetAtTime(0, now + 0.18, 0.08); // release curve

    osc.start(now);
    osc.stop(now + 0.5);

    this._activeKeys.set(whiteIdx, { osc, gain });

    // Animacja naciśnięcia
    this._pressAnim[whiteIdx] = 1.0;

    // Historia
    this._history.push(whiteIdx);
    if (this._history.length > 16) this._history.shift();

    // Sprawdź melodie
    this._checkMelodies();
  }

  _checkMelodies() {
    const h = this._history;
    for (const mel of MELODIES) {
      const seq = mel.notes;
      if (h.length < seq.length) continue;
      const tail = h.slice(h.length - seq.length);
      if (tail.every((n, i) => n === seq[i])) {
        this._melodyBanner = { text: `🎵 ${mel.name}!`, t: 3000 };
        return;
      }
    }
  }

  // ─── Lifecycle ───────────────────────────────────────────
  start(player) {
    this.player  = player;
    this._cursor = NUM_WHITE / 2;
    this._cursorI = Math.round(this._cursor);
    this._history = [];
    this._melodyBanner = null;
    this._pressAnim.fill(0);
    this.running = true;
  }

  resize(W, H) { this.W = W; this.H = H; }

  onMouseMove(nx, ny) {
    this._mx = nx;
    // Mysz: mapuj X na klawisz
    const keyW = this.W / NUM_WHITE;
    this._cursor = clamp(nx * this.W / keyW, 0, NUM_WHITE - 1);
    this._cursorI = Math.round(this._cursor);
  }

  onClick(nx, ny) {
    // Kliknięcie: czy w obszarze klawiatury?
    const pianoTop = this.H * 0.55;
    if (ny * this.H < pianoTop) return;

    // Ustal który klawisz kliknięty
    const keyW = this.W / NUM_WHITE;
    const clickX = nx * this.W;
    const clickY = ny * this.H;

    // Sprawdź czarne klawisze najpierw (są na wierzchu)
    const bKeyH = (this.H - pianoTop) * 0.58;
    for (const [leftIdx, semi, name] of BLACK_KEYS) {
      const bx = (leftIdx + 1) * keyW - keyW * 0.3;
      const bw = keyW * 0.58;
      if (clickX >= bx && clickX <= bx + bw && clickY >= pianoTop && clickY <= pianoTop + bKeyH) {
        // Zagraj czarny klawisz (mapujemy na najbliższy biały do podświetlenia)
        this._ensureAudio();
        if (this._audioCtx) {
          const freq = this._noteFreq(semi);
          const ac = this._audioCtx, now = ac.currentTime;
          const osc = ac.createOscillator(), g = ac.createGain();
          osc.connect(g); g.connect(ac.destination);
          osc.type = 'sine'; osc.frequency.value = freq;
          g.gain.setValueAtTime(0, now);
          g.gain.linearRampToValueAtTime(0.5, now + 0.02);
          g.gain.setTargetAtTime(0, now + 0.18, 0.08);
          osc.start(now); osc.stop(now + 0.5);
        }
        return;
      }
    }

    // Biały klawisz
    const wi = clamp(Math.floor(clickX / keyW), 0, NUM_WHITE - 1);
    this._cursor = wi;
    this._cursorI = wi;
    this._playNote(wi);
  }

  onKeyDown(code) {
    this._keys[code] = true;
    if (code === 'ArrowRight') this._kDir = 1;
    if (code === 'ArrowLeft')  this._kDir = -1;
    if (code === 'Space' || code === 'Enter') {
      this._playNote(clamp(Math.round(this._cursor), 0, NUM_WHITE - 1));
    }
    // Klawisze A-L = nuty
    const keyMap = {
      'KeyA': 0, 'KeyS': 1, 'KeyD': 2, 'KeyF': 3, 'KeyG': 4, 'KeyH': 5,
      'KeyJ': 6, 'KeyK': 7, 'KeyL': 8,
    };
    if (keyMap[code] !== undefined) {
      this._cursor = keyMap[code];
      this._cursorI = keyMap[code];
      this._playNote(keyMap[code]);
    }
  }

  onKeyUp(code) {
    this._keys[code] = false;
    if (code === 'ArrowLeft' || code === 'ArrowRight') this._kDir = 0;
  }

  update(dt) {
    if (!this.running) return;
    this._t += dt;

    // Kapsel: przesuń kursor
    if (this.triki.connected) {
      const gz = -this.triki.GZ(); // L/R: + = prawo
      this._cursor += gz * 0.008 * dt;
      this._cursor = clamp(this._cursor, 0, NUM_WHITE - 1);
      this._cursorI = Math.round(this._cursor);

      if (this.triki.consumeClick()) {
        this._playNote(clamp(this._cursorI, 0, NUM_WHITE - 1));
      }
    } else if (this._kDir !== 0) {
      // Klawiatura: strzałki
      this._cursor += this._kDir * 0.012 * dt;
      this._cursor = clamp(this._cursor, 0, NUM_WHITE - 1);
      this._cursorI = Math.round(this._cursor);
    }

    // Zanikanie animacji klawiszy
    for (let i = 0; i < NUM_WHITE; i++) {
      if (this._pressAnim[i] > 0) {
        this._pressAnim[i] = Math.max(0, this._pressAnim[i] - dt * 0.004);
      }
    }

    // Banner melodii
    if (this._melodyBanner) {
      this._melodyBanner.t -= dt;
      if (this._melodyBanner.t <= 0) this._melodyBanner = null;
    }
  }

  draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    // Tło
    ctx.fillStyle = '#0d0814';
    ctx.fillRect(0, 0, W, H);

    // Subtelna siatka
    ctx.save();
    ctx.strokeStyle = 'rgba(168,85,247,0.06)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
    ctx.restore();

    const pianoTop  = H * 0.55;
    const pianoH    = H - pianoTop;
    const keyW      = W / NUM_WHITE;
    const keyH      = pianoH;
    const bKeyH     = pianoH * 0.58;
    const bKeyW     = keyW * 0.58;

    // === Aktywna nuta (górna część) ===
    const ci = clamp(this._cursorI, 0, NUM_WHITE - 1);
    const noteName  = WHITE_NAMES[ci];
    const noteColor = NOTE_COLORS[noteName] || '#a855f7';
    const noteFreq  = this._noteFreq(WHITE_SEMITONES[ci]);

    ctx.save();
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = noteColor;
    ctx.shadowColor  = noteColor;
    ctx.shadowBlur   = 24;
    ctx.font = `900 ${Math.round(W * 0.22)}px Outfit, sans-serif`;
    ctx.fillText(noteName, W / 2, H * 0.17);
    ctx.shadowBlur = 0;
    ctx.fillStyle  = 'rgba(255,255,255,0.38)';
    ctx.font = `bold ${Math.round(W * 0.055)}px Outfit, sans-serif`;
    ctx.fillText(`${Math.round(noteFreq)} Hz`, W / 2, H * 0.30);
    ctx.restore();

    // === Historia melodii (kolorowe kółka) ===
    const histShow = this._history.slice(-8);
    if (histShow.length > 0) {
      const dotR  = Math.min(18, W * 0.032);
      const totalW = histShow.length * (dotR * 2 + 6);
      let hx = W / 2 - totalW / 2 + dotR;
      const hy = H * 0.43;
      histShow.forEach((ni, idx) => {
        const col   = NOTE_COLORS[WHITE_NAMES[ni]] || '#a855f7';
        const alpha = 0.35 + 0.65 * (idx / (histShow.length - 1 || 1));
        ctx.save();
        ctx.globalAlpha  = alpha;
        ctx.fillStyle    = col;
        ctx.shadowColor  = col;
        ctx.shadowBlur   = 8;
        ctx.beginPath();
        ctx.arc(hx, hy, dotR, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur   = 0;
        ctx.fillStyle    = 'rgba(0,0,0,0.7)';
        ctx.font = `bold ${Math.round(dotR * 0.9)}px Outfit, sans-serif`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(WHITE_NAMES[ni], hx, hy + 1);
        ctx.restore();
        hx += dotR * 2 + 6;
      });
    } else {
      ctx.fillStyle    = 'rgba(255,255,255,0.18)';
      ctx.font = `${Math.round(W * 0.038)}px Outfit, sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('zagraj nutę…', W / 2, H * 0.43);
    }

    // === Klawiatura — białe klawisze ===
    for (let i = 0; i < NUM_WHITE; i++) {
      const kx     = i * keyW;
      const ky     = pianoTop;
      const isActive = (i === ci);
      const pressT   = this._pressAnim[i];
      const pressOffset = pressT * 6; // wciskanie klawisza

      const col = NOTE_COLORS[WHITE_NAMES[i]] || '#a855f7';
      ctx.save();

      if (isActive) {
        // Podświetlony klawisz: zabarwiony
        ctx.fillStyle   = `rgba(${hexToRgb(col)}, 0.88)`;
        ctx.shadowColor = col;
        ctx.shadowBlur  = 18;
      } else if (pressT > 0) {
        // Animacja naciśnięcia (zanikająca poświata)
        ctx.fillStyle = `rgba(${hexToRgb(col)}, ${0.3 + pressT * 0.55})`;
        ctx.shadowColor = col;
        ctx.shadowBlur  = pressT * 14;
      } else {
        ctx.fillStyle = 'rgba(240,240,240,0.92)';
      }

      ctx.beginPath();
      ctx.roundRect(kx + 2, ky + pressOffset, keyW - 4, keyH - pressOffset - 4, 4);
      ctx.fill();

      // Obwódka
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Etykieta nuty na dole klawisza
      ctx.shadowBlur = 0;
      ctx.fillStyle  = isActive ? 'rgba(0,0,0,0.85)' : 'rgba(60,20,80,0.7)';
      ctx.font = `bold ${Math.round(keyW * 0.38)}px Outfit, sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(WHITE_NAMES[i], kx + keyW / 2, ky + keyH - 6);

      ctx.restore();
    }

    // === Klawiatura — czarne klawisze ===
    for (const [leftIdx, semi, name] of BLACK_KEYS) {
      const bx = (leftIdx + 1) * keyW - bKeyW / 2;
      const by = pianoTop;
      const col = NOTE_COLORS[name] || '#8b5cf6';

      ctx.save();
      ctx.fillStyle   = `rgba(20,5,35,0.95)`;
      ctx.shadowColor = col;
      ctx.shadowBlur  = 6;
      ctx.beginPath();
      ctx.roundRect(bx, by, bKeyW, bKeyH, 4);
      ctx.fill();

      // Górna poświata
      ctx.shadowBlur = 0;
      ctx.fillStyle  = `rgba(${hexToRgb(col)}, 0.35)`;
      ctx.beginPath();
      ctx.roundRect(bx + 3, by, bKeyW - 6, bKeyH * 0.35, 3);
      ctx.fill();

      // Etykieta
      ctx.fillStyle  = 'rgba(255,255,255,0.55)';
      ctx.font = `${Math.round(bKeyW * 0.35)}px Outfit, sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(name.replace('5',''), bx + bKeyW / 2, by + bKeyH - 3);
      ctx.restore();
    }

    // === Wskaźnik kursora BLE (strzałka nad aktywnym klawiszem) ===
    if (this.triki.connected) {
      const cx = ci * keyW + keyW / 2;
      ctx.save();
      ctx.fillStyle   = noteColor;
      ctx.shadowColor = noteColor;
      ctx.shadowBlur  = 12;
      ctx.beginPath();
      const arY = pianoTop - 12;
      ctx.moveTo(cx, arY);
      ctx.lineTo(cx - 8, arY - 16);
      ctx.lineTo(cx + 8, arY - 16);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // === Banner rozpoznanej melodii ===
    if (this._melodyBanner) {
      const alpha = Math.min(1, this._melodyBanner.t / 400);
      ctx.save();
      ctx.globalAlpha  = alpha;
      ctx.fillStyle    = 'rgba(0,0,0,0.75)';
      ctx.fillRect(0, H * 0.08 - 28, W, 56);
      ctx.fillStyle    = '#f0abfc';
      ctx.shadowColor  = '#d946ef';
      ctx.shadowBlur   = 22;
      ctx.font = `900 ${Math.round(W * 0.065)}px Outfit, sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this._melodyBanner.text, W / 2, H * 0.08);
      ctx.restore();
    }

    // === Podpowiedź (gdy nie ma historii) ===
    if (!this.triki.connected && this._history.length === 0) {
      ctx.fillStyle    = 'rgba(255,255,255,0.22)';
      ctx.font = `${Math.round(W * 0.03)}px Outfit, sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Kliknij klawisz lub użyj ←/→ + Spacja', W / 2, H * 0.50);
    }
  }

  drawIdle() { this.draw(); }

  destroy() {
    this.running = false;
    try { this._audioCtx?.close(); } catch (_) {}
    this._audioCtx = null;
  }
}

// Konwertuj hex #rrggbb na "r,g,b" dla rgba()
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}
