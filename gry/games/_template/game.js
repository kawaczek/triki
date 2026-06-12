// games/_template/game.js — SZABLON nowej gry
// Skopiuj cały katalog _template → nazwa_gry, zmień meta.json i game.js.
// Katalogi zaczynające się od "_" są ignorowane przez serwer.
//
// Wspólne narzędzia (clamp, rand, drawGrid, radialGlow, drawHintBubble):
//   import { clamp, drawGrid } from '../../static/gameutils.js';
//
// UWAGA: inicjalizuj cały stan gry w konstruktorze — drawIdle() może być
// wywołane PRZED start() (ekran startowy z podglądem gry w tle).
//
// Kontrakt klasy gry (WYMAGANE):
//   constructor(canvas, ctx, triki, emit)
//   start(player)        — player: {nick, color, deviceId} | null
//   update(dt)           — dt: ms od ostatniej klatki
//   draw(dt)             — rysowanie na canvas
//   resize(W, H)         — wywoływane przy zmianie rozmiaru
//   onMouseMove(nx, ny)  — nx/ny w zakresie [0,1]; wywoływane tylko gdy !triki.connected
//   onClick(nx, ny)
//   onKeyDown(code)      — KeyboardEvent.code np. "ArrowLeft"
//   drawIdle()           — rysowanie na ekranie startowym (przed startem)
//   destroy()            — sprzątanie
//   running              — flaga (false → koniec pętli)
//
// emit API:
//   emit('stats', html)  — aktualizuje pasek w nagłówku gry
//   emit('end', {score}) — gra skończona, score → tabela wyników
//   emit('end', {won, playerScore, aiScore}) — gra 2-wynikowa (np. Pong)

export default class TemplateGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas  = canvas;
    this.ctx     = ctx;
    this.triki   = triki;
    this.emit    = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;
    this._mx = 0.5; this._my = 0.5;
    this.score = 0;
    this.t = 0;
  }

  start(player) {
    this.player  = player;
    this.score   = 0;
    this.t       = 0;
    this.running = true;
  }

  resize(W, H) { this.W = W; this.H = H; }

  onMouseMove(nx, ny) { this._mx = nx; this._my = ny; }
  onClick(nx, ny)     {
    // przykład: każde kliknięcie +1 punkt
    this.score++;
    this.emit('stats', `<b>${this.score}</b> pkt`);
  }
  onKeyDown(code) {}

  update(dt) {
    if (!this.running) return;
    this.t += dt;
    // zakończ grę po 10 sekundach
    if (this.t > 10_000) {
      this.running = false;
      this.emit('end', { score: this.score });
    }
  }

  draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);
    // siatka tła
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
    ctx.restore();

    // prosty kursor
    ctx.beginPath();
    ctx.arc(this._mx * W, this._my * H, 20, 0, Math.PI*2);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth   = 3;
    ctx.stroke();

    // wynik
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font      = `bold ${Math.round(W/10)}px Outfit,sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(this.score, W/2, H/2);
  }

  drawIdle() { this.draw(); }
  destroy()  { this.running = false; }
}
