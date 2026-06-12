// Żulki — Milionerzy w żulowym stylu
// 1723 pytania z oryginalnej bazy Żulionerzy (Ortalion Entertainment)
// Załaduj pytania dynamicznie z questions.json

let QUESTIONS = [];
let _questionsLoaded = false;

async function _loadQuestions() {
  if (_questionsLoaded) return;
  try {
    const r = await fetch('games/zulki/questions.json');
    const raw = await r.json();
    // Shuffle odpowiedzi — answer1 jest zawsze poprawna w pliku źródłowym
    QUESTIONS = raw.map(p => {
      const correct = p.a[p.ok];
      const others = p.a.filter((_, i) => i !== p.ok);
      // Wstaw poprawną na losową pozycję
      const pos = Math.floor(Math.random() * 4);
      const shuffled = [...others.slice(0, pos), correct, ...others.slice(pos)];
      return { q: p.q, a: shuffled, ok: pos };
    });
    // Przetasuj pytania
    QUESTIONS.sort(() => Math.random() - 0.5);
    _questionsLoaded = true;
  } catch(e) {
    console.warn('Błąd ładowania pytań, używam awaryjnych:', e);
    QUESTIONS = [
      { q: "Ile nóg ma pająk?", a: ["4", "8", "6", "12"], ok: 1 },
      { q: "Stolica Polski?", a: ["Kraków", "Gdańsk", "Warszawa", "Łódź"], ok: 2 },
      { q: "Z czego robi się wino?", a: ["Jabłek", "Winogron", "Ziemniaków", "Pszenicy"], ok: 1 },
    ];
    _questionsLoaded = true;
  }
}

const WHEEL = [
  { label: "POLÓWKA", color: "#f59e0b", emoji: "⬇️", effect: "half" },
  { label: "ŚCIÉPA",  color: "#ef4444", emoji: "💀", effect: "lose" },
  { label: "TELEFON", color: "#22c55e", emoji: "📞", effect: "phone" },
  { label: "BOMBA",   color: "#a855f7", emoji: "💣", effect: "bomb" },
  { label: "POLÓWKA", color: "#f59e0b", emoji: "⬇️", effect: "half" },
  { label: "ŚCIÉPA",  color: "#ef4444", emoji: "💀", effect: "lose" },
  { label: "BONUS",   color: "#3b82f6", emoji: "⭐", effect: "bonus" },
  { label: "ŚCIÉPA",  color: "#ef4444", emoji: "💀", effect: "lose" },
];

const PRIZES = [500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 250000, 1000000];
const SAFE = [4, 9]; // indeksy "gwarantowanych" nagród (5000, 1M)

const LETTERS = ["A", "B", "C", "D"];
const TILT_THRESH = 0.35; // gz °/s → wybór odpowiedzi

// Żulowe komentarze
const COMMENTS_OK  = ["Nieźle, nieźle! 🍺", "Wiedziałeś to! 😎", "Prawidłowo! 🎉", "Dobra robota! 👍", "Mądra głowa! 🧠"];
const COMMENTS_BAD = ["Ojoj... 😬", "Nie ta odpowiedź...", "Oj, Zulbert płacze 😢", "Prawie! Ale prawie nie robi różnicy...", "Głęboki oddech... 💀"];
const COMMENTS_PHONE = ["Dzwoni Zulbert! 📞", "A co ty myślisz...?", "Hmm, wydaje mi się że... może C?", "Słuchaj, nie jestem pewien...", "Zdecydowanie B! Albo D. Chyba."];

export default class ZulkiGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas; this.ctx = ctx; this.triki = triki; this.emit = emit;
    this._state = "idle"; // idle | question | wheel | phone | result | end
    this._qIdx = 0;
    this._order = [];
    this._selected = 0;
    this._score = 0;
    this._level = 0;
    this._lifelines = { half: true, phone: true, wheel: true };
    this._eliminated = []; // wyeliminowane odpowiedzi (lifeline)
    this._wheelAngle = 0;
    this._wheelVel = 0;
    this._wheelDone = false;
    this._wheelResult = null;
    this._comment = "";
    this._commentT = 0;
    this._t = 0;
    this._rotLatch = false;
    this._ansT = 0;  // timer po wybraniu odpowiedzi
    this._ansState = ""; // "correct"|"wrong"|""
    this._phoneText = "";
    this._phoneT = 0;
    this._gz = 0;
    this._tiltSel = 0;
    this._tiltT = 0;
    this._kDir = 0;
    this._kDirY = 0;
    this._kConfirm = false;
    this._kWheel = false;
  }

  start(player) {
    this._player = player;
    this._score = 0;
    this._level = 0;
    this._lifelines = { half: true, phone: true, wheel: true };
    this._eliminated = [];
    this._selected = 0;
    this._ansState = "";
    this._wheelDone = false;
    this._endEmitted = false;
    this._state = "loading";
    _loadQuestions().then(() => {
      this._order = [...Array(QUESTIONS.length).keys()].sort(() => Math.random() - 0.5);
      this._qIdx = 0;
      this._state = "question";
    });
  }

  _currentQ() { return QUESTIONS[this._order[this._qIdx % this._order.length]]; }

  _confirmAnswer() {
    if (this._ansState !== "") return; // już odpowiedziano
    const q = this._currentQ();
    if (this._eliminated.includes(this._selected)) return;
    this._ansState = this._selected === q.ok ? "correct" : "wrong";
    this._ansT = 0;
    this._comment = this._ansState === "correct"
      ? COMMENTS_OK[Math.floor(Math.random() * COMMENTS_OK.length)]
      : COMMENTS_BAD[Math.floor(Math.random() * COMMENTS_BAD.length)];
    this._commentT = 2200;
  }

  _nextQuestion() {
    if (this._ansState !== "correct") {
      // przegrana
      const safe = SAFE.filter(s => s < this._level);
      const safePrize = safe.length > 0 ? PRIZES[safe[safe.length - 1]] : 0;
      this._score = safePrize;
      this._state = "end";
      return;
    }
    this._level++;
    if (this._level >= PRIZES.length) {
      this._score = PRIZES[PRIZES.length - 1];
      this._state = "end";
      return;
    }
    this._qIdx++;
    this._eliminated = [];
    this._selected = this._nextValidSel(0);
    this._ansState = "";
    this._state = "question";
  }

  _nextValidSel(start) {
    let s = start % 4;
    for (let i = 0; i < 4; i++) {
      if (!this._eliminated.includes(s)) return s;
      s = (s + 1) % 4;
    }
    return start;
  }

  _useHalf() {
    if (!this._lifelines.half) return;
    this._lifelines.half = false;
    const q = this._currentQ();
    // Usuń 2 błędne odpowiedzi
    const wrongs = [0,1,2,3].filter(i => i !== q.ok && !this._eliminated.includes(i));
    const toRemove = wrongs.sort(() => Math.random() - 0.5).slice(0, 2);
    this._eliminated.push(...toRemove);
    if (this._eliminated.includes(this._selected)) {
      this._selected = this._nextValidSel(0);
    }
  }

  _usePhone() {
    if (!this._lifelines.phone) return;
    this._lifelines.phone = false;
    const q = this._currentQ();
    // "Ekspert" daje 70% szansy na dobrą odpowiedź
    const correct = Math.random() < 0.70;
    const hint = correct ? q.ok : (q.ok + 1 + Math.floor(Math.random() * 3)) % 4;
    this._phoneText = COMMENTS_PHONE[Math.floor(Math.random() * COMMENTS_PHONE.length)]
      + "\nMoim zdaniem... " + LETTERS[hint] + "!";
    this._state = "phone";
    this._phoneT = 3500;
  }

  _useWheel() {
    if (!this._lifelines.wheel) return;
    this._lifelines.wheel = false;
    this._state = "wheel";
    this._wheelAngle = 0;
    this._wheelVel = 0.012 + Math.random() * 0.01;
    this._wheelDone = false;
    this._wheelResult = null;
  }

  _applyWheelResult() {
    const seg = WHEEL.length;
    const idx = Math.floor(((this._wheelAngle % (Math.PI * 2)) / (Math.PI * 2)) * seg + 0.5) % seg;
    this._wheelResult = WHEEL[idx];
    this._wheelDone = true;
    switch (this._wheelResult.effect) {
      case "half":
        // Następna odpowiedź - koszt: stracisz połowę obecnej nagrody jeśli przegrasz
        this._comment = "Koło mówi: polówka! Jeśli przegrasz, możesz zachować połowę. 😅";
        break;
      case "lose":
        this._comment = "Ściépa! 💀 Zulbert się śmieje...";
        this._score = 0;
        setTimeout(() => { this._state = "end"; }, 2500);
        return;
      case "phone":
        this._comment = "Telefon! 📞 Dzwoni Zulbert z podpowiedzią!";
        this._lifelines.phone = true; // daje lifeline z powrotem
        break;
      case "bomb":
        this._comment = "Bomba! 💣 Dwie złe odpowiedzi znikają!";
        this._lifelines.half = true;
        break;
      case "bonus":
        this._comment = "Bonus! ⭐ Podwajamy obecną nagrodę!";
        if (this._level > 0) this._score = PRIZES[Math.min(this._level + 1, PRIZES.length - 1)];
        break;
    }
    this._commentT = 2500;
    setTimeout(() => { this._state = "question"; }, 2600);
  }

  update(dt) {
    this._t += dt;

    if (this._commentT > 0) this._commentT -= dt;

    // Koło
    if (this._state === "wheel" && !this._wheelDone) {
      const gz = this.triki.connected ? Math.abs(this.triki.gz) : 0;
      let spin = gz * Math.PI / 180 / 1000 * 3;

      // Dodatkowe zakręcenie kołem przez potrząśnięcie kapslem
      const g = Math.hypot(this.triki.ax, this.triki.ay, this.triki.az);
      const isShaking = this.triki.connected && (Math.abs(g - 1.0) > 0.22);
      if (isShaking) {
        spin = 0.015 + Math.random() * 0.012;
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(60);
      }

      if (spin > this._wheelVel) this._wheelVel = spin;
      this._wheelVel *= 0.998;
      this._wheelAngle += this._wheelVel * dt;
      if (this._wheelVel < 0.0005) {
        this._applyWheelResult();
      }

      // Kliknięcie ekranu = zakręć bez BLE
      return;
    }

    // Telefon - odliczanie
    if (this._state === "phone") {
      this._phoneT -= dt;
      if (this._phoneT <= 0) {
        this._state = "question";
      }
      return;
    }

    if (this._state === "loading") return;
    if (this._state !== "question") return;
    if (this._ansState !== "") {
      this._ansT += dt;
      if (this._ansT > 1800) this._nextQuestion();
      return;
    }

    // Wybór odpowiedzi za pomocą obracania kapsla (ROT) w lewo/prawo
    if (this.triki.connected) {
      const rotVal = this.triki.ROT?.() ?? 0;
      if (!this._rotLatch) {
        if (rotVal > 25) {
          // Następna odpowiedź
          let next = (this._selected + 1) % 4;
          while (this._eliminated.includes(next)) {
            next = (next + 1) % 4;
          }
          this._selected = next;
          this._rotLatch = true;
          if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30);
        } else if (rotVal < -25) {
          // Poprzednia odpowiedź
          let next = (this._selected + 3) % 4;
          while (this._eliminated.includes(next)) {
            next = (next + 3) % 4;
          }
          this._selected = next;
          this._rotLatch = true;
          if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30);
        }
      } else {
        if (Math.abs(rotVal) < 8) {
          this._rotLatch = false;
        }
      }
    } else {
      // Sterowanie awaryjne klawiaturą w edytorze/symulatorze
      const gz = this._kDir * 100;
      if (Math.abs(gz) > 40) {
        this._tiltT += dt;
        if (this._tiltT > 300) {
          this._tiltT = 0;
          let next = gz > 0 ? (this._selected + 1) % 4 : (this._selected + 3) % 4;
          while (this._eliminated.includes(next)) {
            next = gz > 0 ? (next + 1) % 4 : (next + 3) % 4;
          }
          this._selected = next;
        }
      } else {
        this._tiltT = 0;
      }
    }

    // BLE button = zatwierdź (TYLKO guzik)
    if (this.triki.consumeClick?.()) this._confirmAnswer();
    if (this._kConfirm) { this._kConfirm = false; this._confirmAnswer(); }

    // Klawiatura lifelines
    if (this._kWheel) { this._kWheel = false; this._useWheel(); }
  }

  draw() {
    const { width: W, height: H } = this.canvas;
    const ctx = this.ctx;

    if (this._state === "wheel")   { this._drawWheel(W, H); return; }
    if (this._state === "phone")   { this._drawPhone(W, H); return; }
    if (this._state === "end")     { this._drawEnd(W, H); return; }

    // TŁO
    ctx.fillStyle = '#0a0c10'; ctx.fillRect(0, 0, W, H);

    if (this._state === "idle")    { this._drawIdle(W, H); return; }
    if (this._state === "loading") { this._drawLoading(W, H); return; }

    // GÓRNY PASEK — poziom + nagroda
    const prize = this._level > 0 ? PRIZES[this._level - 1] : 0;
    const nextPrize = PRIZES[Math.min(this._level, PRIZES.length - 1)];
    const isSafe = SAFE.includes(this._level);

    ctx.fillStyle = isSafe ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, 0, W, 52);
    ctx.fillStyle = '#f59e0b';
    ctx.font = `bold ${Math.round(W * 0.04)}px Outfit, monospace`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(`💰 ${prize.toLocaleString('pl')} zł`, 12, 26);
    ctx.fillStyle = '#22c55e';
    ctx.textAlign = 'center';
    ctx.fillText(`🎯 Pytanie ${this._level + 1}/10 → ${nextPrize.toLocaleString('pl')} zł`, W/2, 26);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = `${Math.round(W * 0.028)}px Outfit, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText(isSafe ? '🔒 GWARANTOWANE' : '', W - 10, 26);

    // PYTANIE
    const q = this._currentQ();
    const qY = 70;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath(); ctx.roundRect(8, qY, W - 16, Math.round(H * 0.18), 12); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(W * 0.042)}px Outfit, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    this._wrapText(ctx, q.q, W/2, qY + Math.round(H * 0.09), W - 40, Math.round(W * 0.042) * 1.3);

    // ODPOWIEDZI — układ 2×2: A/B górny rząd, C/D dolny rząd
    const areaY = qY + Math.round(H * 0.20);
    const areaH = H - areaY - 60;   // zostaw miejsce na lifelines
    const aH = Math.round(areaH / 2) - 6;
    const aW = Math.round(W / 2) - 12;
    const aGap = 8;
    const ANSWER_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444"];

    // pozycje: 0=A(lewo góra), 1=B(prawo góra), 2=C(lewo dół), 3=D(prawo dół)
    const aPos = [
      { x: 8,          y: areaY },
      { x: 8 + aW + aGap, y: areaY },
      { x: 8,          y: areaY + aH + aGap },
      { x: 8 + aW + aGap, y: areaY + aH + aGap },
    ];

    q.a.forEach((ans, i) => {
      const { x, y } = aPos[i];
      const isElim = this._eliminated.includes(i);
      const isSel = this._selected === i && !isElim;
      const isCorrect = this._ansState !== "" && i === q.ok;
      const isWrong = this._ansState === "wrong" && i === this._selected && i !== q.ok;

      let bg = isElim ? 'rgba(255,255,255,0.03)' :
               isCorrect ? 'rgba(34,197,94,0.35)' :
               isWrong ? 'rgba(239,68,68,0.35)' :
               isSel ? ANSWER_COLORS[i] + '33' : 'rgba(255,255,255,0.06)';
      let border = isElim ? 'transparent' :
                   isCorrect ? '#22c55e' :
                   isWrong ? '#ef4444' :
                   isSel ? ANSWER_COLORS[i] : 'rgba(255,255,255,0.12)';

      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.roundRect(x, y, aW, aH, 10); ctx.fill();
      ctx.strokeStyle = border; ctx.lineWidth = isSel || isCorrect || isWrong ? 2 : 1;
      ctx.stroke();

      const letterSize = Math.round(W * 0.044);
      const textSize   = Math.round(W * 0.033);

      // Litera
      ctx.fillStyle = isElim ? 'rgba(255,255,255,0.15)' : ANSWER_COLORS[i];
      ctx.font = `bold ${letterSize}px Outfit, sans-serif`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(LETTERS[i], x + 10, y + 8);

      // Tekst odpowiedzi — zawijany
      ctx.fillStyle = isElim ? 'rgba(255,255,255,0.2)' : isSel ? '#fff' : 'rgba(255,255,255,0.8)';
      ctx.font = `${isSel ? 'bold ' : ''}${textSize}px Outfit, sans-serif`;
      ctx.textBaseline = 'middle';
      this._wrapText(ctx, ans, x + aW / 2, y + aH / 2 + 6, aW - 16, textSize * 1.25);

      if (isElim) {
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x + 8, y + aH/2); ctx.lineTo(x + aW - 8, y + aH/2); ctx.stroke();
      }
    });

    // Komentarz
    if (this._commentT > 0) {
      const alpha = Math.min(1, this._commentT / 400);
      ctx.fillStyle = `rgba(15,20,30,${alpha * 0.92})`;
      ctx.fillRect(0, H * 0.35, W, H * 0.3);
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.font = `bold ${Math.round(W * 0.05)}px Outfit, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(this._comment, W/2, H * 0.5);
    }

    // LIFELINES
    const llY = H - 52;
    this._drawLifelines(W, llY);

    // Hint
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = `${Math.round(W * 0.026)}px Outfit, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(this.triki.connected
      ? 'Przechyl = wybierz · Guzik = zatwierdź · 1/2/3 = lifeline'
      : '← → ↑ ↓ = wybierz · Enter = zatwierdź · 1/2/3 = lifeline', W/2, H - 4);
  }

  _drawLifelines(W, y) {
    const ctx = this.ctx;
    const items = [
      { key: "half", icon: "½", label: "Pół na pół" },
      { key: "phone", icon: "📞", label: "Telefon" },
      { key: "wheel", icon: "🎡", label: "Koło" },
    ];
    const bw = Math.min((W - 16) / 3 - 6, 120);
    const startX = (W - (items.length * (bw + 6) - 6)) / 2;
    items.forEach((it, i) => {
      const active = this._lifelines[it.key];
      const x = startX + i * (bw + 6);
      ctx.fillStyle = active ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.04)';
      ctx.strokeStyle = active ? '#f59e0b' : 'rgba(255,255,255,0.1)';
      ctx.lineWidth = active ? 1.5 : 1;
      ctx.beginPath(); ctx.roundRect(x, y, bw, 40, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = active ? '#f59e0b' : 'rgba(255,255,255,0.2)';
      ctx.font = `bold ${Math.round(bw * 0.28)}px Outfit, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(it.icon, x + bw/2, y + 14);
      ctx.font = `${Math.round(bw * 0.18)}px Outfit, sans-serif`;
      ctx.fillText(it.label, x + bw/2, y + 30);
    });
  }

  _drawWheel(W, H) {
    const ctx = this.ctx;
    ctx.fillStyle = '#0a0c10'; ctx.fillRect(0, 0, W, H);

    const CX = W/2, CY = H * 0.45, R = Math.min(W, H) * 0.36;
    const N = WHEEL.length;
    const sweep = Math.PI * 2 / N;

    // Sektory
    WHEEL.forEach((seg, i) => {
      const a0 = this._wheelAngle + i * sweep - Math.PI/2;
      const a1 = a0 + sweep;
      ctx.beginPath();
      ctx.moveTo(CX, CY);
      ctx.arc(CX, CY, R, a0, a1);
      ctx.closePath();
      ctx.fillStyle = seg.color + 'cc'; ctx.fill();
      ctx.strokeStyle = '#0a0c10'; ctx.lineWidth = 2; ctx.stroke();

      // Etykiety
      const mid = a0 + sweep / 2;
      const tx = CX + Math.cos(mid) * R * 0.68;
      const ty = CY + Math.sin(mid) * R * 0.68;
      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(mid + Math.PI/2);
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(R * 0.12)}px Outfit, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(seg.emoji, 0, -Math.round(R * 0.09));
      ctx.font = `bold ${Math.round(R * 0.09)}px Outfit, sans-serif`;
      ctx.fillText(seg.label, 0, Math.round(R * 0.09));
      ctx.restore();
    });

    // Obwódka
    ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 3; ctx.stroke();

    // Strzałka wskaźnik (góra)
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(CX, CY - R - 5);
    ctx.lineTo(CX - 12, CY - R - 28);
    ctx.lineTo(CX + 12, CY - R - 28);
    ctx.closePath(); ctx.fill();

    // Środek
    ctx.beginPath(); ctx.arc(CX, CY, 22, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0c10'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(W * 0.04)}px Outfit, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🎡', CX, CY);

    // Wynik koła
    if (this._wheelDone && this._wheelResult) {
      ctx.fillStyle = 'rgba(10,12,16,0.88)';
      ctx.fillRect(0, H * 0.78, W, H * 0.22);
      ctx.fillStyle = this._wheelResult.color;
      ctx.font = `900 ${Math.round(W * 0.07)}px Outfit, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`${this._wheelResult.emoji} ${this._wheelResult.label}!`, W/2, H * 0.865);
    }

    if (!this._wheelDone) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = `${Math.round(W * 0.033)}px Outfit, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText('Zakręć kapslem lub kliknij', W/2, H - 8);
    }
  }

  _drawPhone(W, H) {
    const ctx = this.ctx;
    ctx.fillStyle = '#0a0c10'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#22c55e';
    ctx.font = `${Math.round(W * 0.12)}px Outfit, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('📞', W/2, H * 0.25);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(W * 0.05)}px Outfit, sans-serif`;
    ctx.fillText('Zulbert dzwoni...', W/2, H * 0.38);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = `${Math.round(W * 0.04)}px Outfit, sans-serif`;
    this._phoneText.split('\n').forEach((line, i) => {
      ctx.fillText(line, W/2, H * 0.52 + i * Math.round(W * 0.05));
    });
    // Pasek postępu
    const prog = Math.max(0, this._phoneT / 3500);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(W*0.1, H*0.78, W*0.8, 8);
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(W*0.1, H*0.78, W*0.8 * prog, 8);
  }

  _drawEnd(W, H) {
    const ctx = this.ctx;
    ctx.fillStyle = '#0a0c10'; ctx.fillRect(0, 0, W, H);
    const won = this._level >= PRIZES.length;
    ctx.fillStyle = won ? '#f59e0b' : '#ef4444';
    ctx.font = `${Math.round(W * 0.12)}px Outfit, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(won ? '🏆' : '😭', W/2, H * 0.22);
    ctx.fillStyle = '#fff';
    ctx.font = `900 ${Math.round(W * 0.065)}px Outfit, sans-serif`;
    ctx.fillText(won ? 'MILIONER!' : 'Koniec gry!', W/2, H * 0.38);
    ctx.fillStyle = '#f59e0b';
    ctx.font = `bold ${Math.round(W * 0.07)}px Outfit, monospace`;
    ctx.fillText(`${this._score.toLocaleString('pl')} zł`, W/2, H * 0.52);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `${Math.round(W * 0.035)}px Outfit, sans-serif`;
    ctx.fillText(`Pytanie ${this._level}/10 · ${won ? 'Wygrałeś!' : 'Zachowujesz gwarantowane'}`, W/2, H * 0.64);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = `${Math.round(W * 0.03)}px Outfit, sans-serif`;
    ctx.fillText('Kliknij żeby zagrać jeszcze raz', W/2, H * 0.78);

    if (this._score > 0 && !this._endEmitted) {
      this._endEmitted = true;
      this.emit('end', { score: this._score });
    }
  }

  _drawLoading(W, H) {
    const ctx = this.ctx;
    const dots = '.'.repeat((Math.floor(this._t / 400) % 4));
    ctx.fillStyle = '#f59e0b';
    ctx.font = `${Math.round(W * 0.1)}px Outfit, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🍺', W/2, H * 0.35);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = `bold ${Math.round(W * 0.045)}px Outfit, sans-serif`;
    ctx.fillText(`Ładuję 1723 pytań${dots}`, W/2, H * 0.55);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = `${Math.round(W * 0.03)}px Outfit, sans-serif`;
    ctx.fillText('Oryginalna baza Żulionerzy', W/2, H * 0.65);
  }

  _drawIdle(W, H) {
    const ctx = this.ctx;
    ctx.fillStyle = '#f59e0b';
    ctx.font = `${Math.round(W * 0.14)}px Outfit, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🍺', W/2, H * 0.28);
    ctx.fillStyle = '#fff';
    ctx.font = `900 ${Math.round(W * 0.07)}px Outfit, sans-serif`;
    ctx.fillText('ŻULKI', W/2, H * 0.45);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `${Math.round(W * 0.035)}px Outfit, sans-serif`;
    ctx.fillText('Milionerzy w żulowym stylu', W/2, H * 0.56);
  }

  _wrapText(ctx, text, x, y, maxW, lineH) {
    const words = text.split(' ');
    let line = '';
    let lines = [];
    for (let w of words) {
      const test = line + (line ? ' ' : '') + w;
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line); line = w;
      } else { line = test; }
    }
    if (line) lines.push(line);
    const totalH = lines.length * lineH;
    lines.forEach((l, i) => {
      ctx.fillText(l, x, y - totalH/2 + i * lineH + lineH/2);
    });
  }

  onClick(nx, ny) {
    const { width: W, height: H } = this.canvas;
    if (this._state === "end") {
      this._endEmitted = false;
      this.start(this._player);
      return;
    }
    if (this._state === "wheel" && !this._wheelDone) {
      // Dodaj obrót kliknięciem
      this._wheelVel = Math.max(this._wheelVel, 0.012 + Math.random() * 0.008);
      return;
    }
    if (this._state !== "question" || this._ansState !== "") return;

    // Lifeline kliknięcie
    const llY = H - 52;
    if (ny * H > llY - 5) {
      const items = ["half", "phone", "wheel"];
      const bw = Math.min((W - 16) / 3 - 6, 120);
      const startX = (W - (items.length * (bw + 6) - 6)) / 2;
      items.forEach((key, i) => {
        const x = startX + i * (bw + 6);
        if (nx * W >= x && nx * W <= x + bw) {
          if (key === "half") this._useHalf();
          else if (key === "phone") this._usePhone();
          else if (key === "wheel") this._useWheel();
        }
      });
      return;
    }

    // Kliknięcie na odpowiedź = TYLKO zaznaczenie, NIE zatwierdzenie
    const q = this._currentQ();
    const areaY = 70 + Math.round(H * 0.20);
    const areaH = H - areaY - 60;
    const aH = Math.round(areaH / 2) - 6;
    const aW = Math.round(W / 2) - 12;
    const aGap = 8;
    const aPos = [
      { x: 8,          y: areaY },
      { x: 8 + aW + aGap, y: areaY },
      { x: 8,          y: areaY + aH + aGap },
      { x: 8 + aW + aGap, y: areaY + aH + aGap },
    ];
    aPos.forEach(({ x, y }, i) => {
      if (nx * W >= x && nx * W <= x + aW && ny * H >= y && ny * H <= y + aH) {
        if (!this._eliminated.includes(i)) this._selected = i;
      }
    });
  }

  onKeyDown(code) {
    if (code === 'ArrowRight') this._kDir =  1;
    if (code === 'ArrowLeft')  this._kDir = -1;
    if (code === 'ArrowDown')  this._kDirY =  1;
    if (code === 'ArrowUp')    this._kDirY = -1;
    if (code === 'Enter' || code === 'Space')          this._kConfirm = true;
    if (code === 'Digit1' || code === 'KeyH')          { if (this._lifelines.half)  this._useHalf(); }
    if (code === 'Digit2' || code === 'KeyP')          { if (this._lifelines.phone) this._usePhone(); }
    if (code === 'Digit3' || code === 'KeyW')          { if (this._lifelines.wheel) this._useWheel(); }
    if (this._state === "wheel" && !this._wheelDone) {
      if (code === 'Space' || code === 'Enter') this._wheelVel = Math.max(this._wheelVel, 0.015);
    }
  }
  onKeyUp(code) {
    if (['ArrowLeft','ArrowRight'].includes(code)) this._kDir = 0;
    if (['ArrowUp','ArrowDown'].includes(code))    this._kDirY = 0;
  }
  onMouseMove() {}
  resize() {}
}
