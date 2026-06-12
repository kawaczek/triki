const SHAKE_G = 1.28;
const SHAKE_DEB = 600;

const CARDS = [
  { type: 'prawda', text: 'Jaka jest twoja największa wstydliwa tajemnica?' },
  { type: 'prawda', text: 'Kogo w tej grupie lubisz najbardziej? A najmniej?' },
  { type: 'prawda', text: 'Jaka była twoja największa porażka w życiu?' },
  { type: 'prawda', text: 'Czy kiedykolwiek kłamałeś/aś komuś bliskiemu? Jak?' },
  { type: 'prawda', text: 'Czego najbardziej się boisz?' },
  { type: 'prawda', text: 'Ile razy w tym tygodniu myłeś/aś zęby?' },
  { type: 'prawda', text: 'Jaki był twój najgorszy randkowy koszmar?' },
  { type: 'prawda', text: 'Co byś zrobił/a za milion złotych czego normalnie byś nie zrobił/a?' },
  { type: 'prawda', text: 'Które zdjęcie na twoim telefonie chciałbyś/chciałabyś skasować?' },
  { type: 'prawda', text: 'Kto z celebrytów był twoim największym crushiem?' },
  { type: 'prawda', text: 'Co to było ostatnie kłamstwo które powiedziałeś/aś?' },
  { type: 'prawda', text: 'Jakie jest twoje najgłupsze przesądzenie?' },
  { type: 'prawda', text: 'Co byś zrobił/a gdybyś wiedział/a że nikt nie patrzy?' },
  { type: 'prawda', text: 'Jaka jest twoja najbardziej niezręczna historia?' },
  { type: 'prawda', text: 'Ile osób z tej grupy widziałeś/aś śpiących?' },
  { type: 'wyzwanie', text: 'Zadzwoń do rodzica i powiedz że jesteś w środku Afryki 🌍' },
  { type: 'wyzwanie', text: 'Tańcz przez 30 sekund bez muzyki' },
  { type: 'wyzwanie', text: 'Naśladuj zwierzę przez minutę — reszta musi zgadnąć' },
  { type: 'wyzwanie', text: 'Zjedz łyżkę czegoś nieapetycznego z lodówki' },
  { type: 'wyzwanie', text: 'Mów tylko szeptem przez następne 3 rundy' },
  { type: 'wyzwanie', text: 'Zrób zdjęcie z najgłupszą miną i wyślij do ostatniej osoby w kontaktach' },
  { type: 'wyzwanie', text: 'Powiedz komplement każdej osobie w grupie. Szczerze.' },
  { type: 'wyzwanie', text: 'Zrób 15 przysiadów teraz, tutaj' },
  { type: 'wyzwanie', text: 'Zaśpiewaj refren ostatniej piosenki której słuchałeś/aś' },
  { type: 'wyzwanie', text: 'Napisz wiadomość do byłego/byłej: "Myślę o Tobie" 😏' },
  { type: 'wyzwanie', text: 'Przez następną rundę mów tylko używając pytań' },
  { type: 'wyzwanie', text: 'Pozwól grupie napisać jeden post na twoim FB/Insta' },
  { type: 'wyzwanie', text: 'Rób pompki aż ktoś ci powie stop' },
  { type: 'wyzwanie', text: 'Zadzwoń do kogoś random i śpiewaj im Sto lat przez 10 sekund' },
  { type: 'wyzwanie', text: 'Zamień się butami z osobą po prawej na 2 rundy' },
];

export default class PrawdaGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas; this.ctx = ctx; this.triki = triki; this.emit = emit;
    this._card    = null;
    this._history = [];
    this._prevG   = 0; this._lastShake = -9999; this._t = 0;
    this._anim    = 0;
    this._running = false;
  }
  start()  { this._running = true; }
  stop()   { this._running = false; }
  resize() {}

  _draw_card() {
    const pool = CARDS.filter(c => !this._history.includes(c));
    if (!pool.length) { this._history = []; }
    const c = pool.length ? pool[Math.floor(Math.random() * pool.length)] : CARDS[Math.floor(Math.random() * CARDS.length)];
    this._history.push(c);
    if (this._history.length > 8) this._history.shift();
    this._card = c; this._anim = 1;
    navigator.vibrate?.(30);
  }

  update(dt) {
    this._t += dt;
    this._anim = Math.max(0, this._anim - dt * 0.002);
    if (!this._running) return;

    const g = Math.hypot(this.triki.ax, this.triki.ay, this.triki.az);
    if (g >= SHAKE_G && this._prevG < SHAKE_G && this._t - this._lastShake > SHAKE_DEB) {
      this._lastShake = this._t; this._draw_card();
    }
    this._prevG = g;
    if (this.triki.consumeClick?.()) this._draw_card();
  }

  draw() {
    const { width: W, height: H } = this.canvas;
    const ctx = this.ctx;
    const CX = W/2, CY = H/2;

    ctx.fillStyle = '#0a0c10'; ctx.fillRect(0, 0, W, H);

    if (!this._card) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = `bold ${Math.round(W * 0.055)}px Outfit, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🎭', CX, CY - 40);
      ctx.fillText('Potrząśnij kapslem!', CX, CY + 20);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.font = `${Math.round(W * 0.036)}px Outfit, sans-serif`;
      ctx.fillText('lub kliknij / naciśnij przycisk', CX, CY + 60);
      return;
    }

    const isPrawda = this._card.type === 'prawda';
    const col      = isPrawda ? '#3b82f6' : '#ef4444';
    const scale    = 1 + this._anim * 0.06;

    // Karta
    const cW = W * 0.88, cH = H * 0.56;
    const cX = (W - cW)/2, cY = (H - cH)/2 - 20;
    ctx.save(); ctx.translate(CX, CY - 20); ctx.scale(scale, scale); ctx.translate(-CX, -(CY-20));
    ctx.fillStyle = col + '22';
    ctx.beginPath(); ctx.roundRect(cX, cY, cW, cH, 16); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(cX, cY, cW, cH, 16); ctx.stroke();

    // Typ
    ctx.fillStyle = col;
    ctx.font = `900 ${Math.round(W * 0.065)}px Outfit, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(isPrawda ? '💬 PRAWDA' : '🔥 WYZWANIE', CX, cY + 18);

    // Treść
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.round(W * 0.052)}px Outfit, sans-serif`;
    ctx.textBaseline = 'top';
    this._wrapText(ctx, this._card.text, CX, cY + 80, cW - 32, Math.round(W * 0.062));
    ctx.restore();

    // Hint
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = `${Math.round(W * 0.034)}px Outfit, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('potrząśnij lub kliknij po następną kartę', CX, H - 24);
  }

  _wrapText(ctx, text, cx, y, maxW, lineH) {
    const words = text.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, cx, y); y += lineH; line = word;
      } else line = test;
    }
    if (line) ctx.fillText(line, cx, y);
  }

  onClick()  { this._draw_card(); }
  onKeyDown(code) {
    if (code === 'Space' || code === 'ArrowRight') this._draw_card();
  }
  onKeyUp() {} onMouseMove() {}
}
