const BLOW_G = 2.2;  // g-force = zdmuchnij

export default class SwiecaGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas; this.ctx = ctx; this.triki = triki; this.emit = emit;
    this._lit      = true;
    this._flicker  = Math.random();
    this._windX    = 0; this._windY = 0;
    this._mouseX   = 0; this._mouseY = -1;
    this._smoke    = [];
    this._prevG    = 0; this._t = 0; this._running = false;
  }
  start()  { this._running = true; this._lit = true; }
  stop()   { this._running = false; }
  resize() {}

  update(dt) {
    this._t += dt;
    this._flicker += (Math.random() - 0.5) * 0.18;
    this._flicker = Math.max(0.1, Math.min(1, this._flicker + (0.7 - this._flicker) * 0.04));
    if (!this._running) return;

    // Wiatr z kapsla lub myszy
    const ax = this.triki.connected ? this.triki.ax : (this._mouseX - 0.5) * 2;
    const ay = this.triki.connected ? this.triki.ay : (this._mouseY > 0 ? -(this._mouseY - 0.3) * 2 : 0);
    this._windX += (ax * 0.5 - this._windX) * 0.08;
    this._windY += (-ay * 0.3 - this._windY) * 0.06;

    // Zdmuchnięcie
    const g = Math.hypot(this.triki.ax, this.triki.ay, this.triki.az);
    if (g >= BLOW_G && this._prevG < BLOW_G && this._lit) {
      this._lit = false;
      for (let i = 0; i < 8; i++) this._smoke.push({ x: 0, y: 0, a: 1, vx: (Math.random()-0.5)*0.3, vy: -0.8 - Math.random() });
    }
    this._prevG = g;

    // Dym
    this._smoke.forEach(s => { s.x += s.vx * dt * 0.05; s.y += s.vy * dt * 0.04; s.a -= dt * 0.001; });
    this._smoke = this._smoke.filter(s => s.a > 0);

    if (this.triki.consumeClick?.()) this._lit = true;
  }

  draw() {
    const { width: W, height: H } = this.canvas;
    const ctx = this.ctx;
    const CX = W/2, BASE = H * 0.78;
    const candleH = H * 0.32, candleW = W * 0.12;

    // Tło
    const lum = this._lit ? 0.06 + this._flicker * 0.04 : 0.02;
    ctx.fillStyle = `rgb(${Math.round(lum*40)},${Math.round(lum*25)},${Math.round(lum*10)})`;
    ctx.fillRect(0, 0, W, H);

    // Poświata świecy na ścianie (tylko gdy zapalona)
    if (this._lit) {
      const grd = ctx.createRadialGradient(CX + this._windX * 60, BASE - candleH - 80 + this._windY * 40, 0, CX, BASE - candleH, W*0.6);
      grd.addColorStop(0, `rgba(255,200,80,${0.18 * this._flicker})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
    }

    // Świecznik
    ctx.fillStyle = '#8b6914';
    ctx.beginPath(); ctx.ellipse(CX, BASE + 12, candleW * 1.4, 12, 0, 0, Math.PI*2); ctx.fill();

    // Świeca (tułów)
    const grdC = ctx.createLinearGradient(CX - candleW, 0, CX + candleW, 0);
    grdC.addColorStop(0, '#d4c5a0'); grdC.addColorStop(0.4, '#f5f0e0'); grdC.addColorStop(1, '#b8a882');
    ctx.fillStyle = grdC;
    ctx.beginPath(); ctx.roundRect(CX - candleW, BASE - candleH, candleW*2, candleH + 10, 6); ctx.fill();

    // Knot
    ctx.strokeStyle = '#3a2a10'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(CX, BASE - candleH); ctx.lineTo(CX + this._windX * 4, BASE - candleH - 20); ctx.stroke();

    if (this._lit) {
      // Płomień
      const fX = CX + this._windX * 28;
      const fY = BASE - candleH - 20;
      const fH = (55 + this._flicker * 30) * (0.8 + Math.abs(this._windX) * 0.2);
      const fW = 18 + this._flicker * 8;
      const lean = this._windX * 22;

      // Zewnętrzny płomień (żółty/pomarańczowy)
      const gF = ctx.createRadialGradient(fX + lean*0.3, fY - fH*0.3, 0, fX + lean*0.3, fY - fH*0.3, fH);
      gF.addColorStop(0, 'rgba(255,255,180,0.95)');
      gF.addColorStop(0.4, 'rgba(255,160,20,0.85)');
      gF.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = gF;
      ctx.beginPath();
      ctx.moveTo(fX, fY);
      ctx.bezierCurveTo(fX + fW + lean, fY - fH*0.4, fX + fW*0.5 + lean, fY - fH*0.9, fX + lean, fY - fH);
      ctx.bezierCurveTo(fX - fW*0.5 + lean, fY - fH*0.9, fX - fW + lean, fY - fH*0.4, fX, fY);
      ctx.fill();

      // Wewnętrzny płomień (biały/błękitny)
      const gFi = ctx.createRadialGradient(fX + lean*0.2, fY - 10, 0, fX + lean*0.2, fY - 10, fH*0.45);
      gFi.addColorStop(0, 'rgba(255,255,255,0.9)');
      gFi.addColorStop(0.5, 'rgba(180,220,255,0.6)');
      gFi.addColorStop(1, 'rgba(100,180,255,0)');
      ctx.fillStyle = gFi;
      ctx.beginPath();
      ctx.ellipse(fX + lean*0.3, fY - fH*0.2, fW*0.45, fH*0.45, 0, 0, Math.PI*2); ctx.fill();

    } else {
      // Dym
      this._smoke.forEach(s => {
        const sx = CX + s.x * W * 0.4, sy = BASE - candleH - 20 + s.y * H * 0.3;
        const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, 18);
        gr.addColorStop(0, `rgba(180,180,180,${s.a * 0.5})`);
        gr.addColorStop(1, 'rgba(180,180,180,0)');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(sx, sy, 18, 0, Math.PI*2); ctx.fill();
      });

      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = `${Math.round(W * 0.038)}px Outfit, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText('dotknij żeby zapalić', CX, H - 30);
    }
  }

  onClick()  { this._lit = true; }
  onMouseMove(nx, ny) { this._mouseX = nx; this._mouseY = ny; }
  onKeyDown(code) { if (code === 'Space') this._lit = !this._lit; }
  onKeyUp() {}
}
