const AXES   = ['ax','ay','az','gx','gy','gz'];
const COLORS = { ax:'#22c55e', ay:'#3b82f6', az:'#a855f7', gx:'#f59e0b', gy:'#ef4444', gz:'#06b6d4' };
const LABELS = { ax:'Accel X', ay:'Accel Y', az:'Accel Z', gx:'Gyro X', gy:'Gyro Y', gz:'Gyro Z' };
const BUF    = 120;   // sampli w historii

export default class SensorGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas; this.ctx = ctx; this.triki = triki; this.emit = emit;
    this._enabled = { ax:true, ay:true, az:true, gx:true, gy:true, gz:true };
    this._bufs    = {};
    AXES.forEach(k => { this._bufs[k] = new Float32Array(BUF).fill(0); });
    this._t = 0; this._sampleT = 0; this._running = false;
  }
  start()  { this._running = true; }
  stop()   { this._running = false; }
  resize() {}

  update(dt) {
    this._t += dt;
    if (!this._running) return;
    this._sampleT += dt;
    if (this._sampleT >= 33) {  // ~30Hz
      this._sampleT = 0;
      AXES.forEach(k => {
        this._bufs[k].copyWithin(0, 1);
        this._bufs[k][BUF - 1] = this.triki[k] || 0;
      });
    }
  }

  draw() {
    const { width: W, height: H } = this.canvas;
    const ctx = this.ctx;

    ctx.fillStyle = '#0a0c10'; ctx.fillRect(0, 0, W, H);

    const plotH = H * 0.46;
    const plotY = H * 0.08;

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = plotY + plotH * (i / 4);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    for (let i = 0; i < 6; i++) {
      const x = W * (i / 6);
      ctx.beginPath(); ctx.moveTo(x, plotY); ctx.lineTo(x, plotY + plotH); ctx.stroke();
    }

    // Oś 0
    const zeroY = plotY + plotH / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(0, zeroY); ctx.lineTo(W, zeroY); ctx.stroke();
    ctx.setLineDash([]);

    // Wykresy
    AXES.forEach(k => {
      if (!this._enabled[k]) return;
      const buf  = this._bufs[k];
      const isG  = k.startsWith('g');
      const scale = isG ? 200 : 2;  // gyro w °/s, accel w g

      ctx.beginPath();
      buf.forEach((v, i) => {
        const x = (i / (BUF - 1)) * W;
        const y = zeroY - (v / scale) * (plotH / 2);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.strokeStyle = COLORS[k]; ctx.lineWidth = 1.5;
      ctx.shadowBlur = 4; ctx.shadowColor = COLORS[k]; ctx.stroke(); ctx.shadowBlur = 0;
    });

    // Aktualne wartości + legenda
    const legendY = plotY + plotH + 20;
    const colW    = W / 3;
    AXES.forEach((k, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      const lx  = col * colW + 10;
      const ly  = legendY + row * 52;
      const enabled = this._enabled[k];
      const val  = this.triki[k] || 0;
      const isG  = k.startsWith('g');

      ctx.globalAlpha = enabled ? 1 : 0.3;

      // Prostokąt legendy
      ctx.fillStyle = enabled ? COLORS[k] + '22' : 'rgba(255,255,255,0.04)';
      ctx.beginPath(); ctx.roundRect(lx, ly, colW - 14, 46, 8); ctx.fill();
      if (enabled) {
        ctx.strokeStyle = COLORS[k] + '66'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(lx, ly, colW - 14, 46, 8); ctx.stroke();
      }

      ctx.fillStyle = enabled ? COLORS[k] : 'rgba(255,255,255,0.3)';
      ctx.font = `bold ${Math.round(W * 0.033)}px Outfit, sans-serif`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(LABELS[k], lx + 8, ly + 6);

      ctx.fillStyle = enabled ? '#fff' : 'rgba(255,255,255,0.25)';
      ctx.font = `bold ${Math.round(W * 0.045)}px Outfit, monospace`;
      ctx.fillText(`${val >= 0 ? '+' : ''}${val.toFixed(isG ? 0 : 3)}${isG ? '°/s' : 'g'}`, lx + 8, ly + 22);

      ctx.globalAlpha = 1;
    });

    // Hint
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.font = `${Math.round(W * 0.030)}px Outfit, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('kliknij oś żeby włączyć/wyłączyć · 1-6 = toggle', W/2, H - 6);

    if (!this.triki.connected) {
      ctx.fillStyle = '#f59e0b';
      ctx.font = `bold ${Math.round(W * 0.035)}px Outfit, sans-serif`;
      ctx.fillText('⚠ Potrzebny kapsel BLE', W/2, plotY + plotH/2);
    }
    ctx.textBaseline = 'alphabetic';
  }

  onClick(nx, ny) {
    const { width: W, height: H } = this.canvas;
    const plotH = H * 0.46, plotY = H * 0.08;
    const legendY = plotY + plotH + 20;
    const colW = W / 3;
    const py = ny * H, px = nx * W;

    AXES.forEach((k, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      const lx  = col * colW + 10, ly = legendY + row * 52;
      if (px >= lx && px <= lx + colW - 14 && py >= ly && py <= ly + 46) {
        this._enabled[k] = !this._enabled[k];
      }
    });
  }

  onKeyDown(code) {
    const map = { Digit1:'ax', Digit2:'ay', Digit3:'az', Digit4:'gx', Digit5:'gy', Digit6:'gz' };
    if (map[code]) this._enabled[map[code]] = !this._enabled[map[code]];
    if (code === 'KeyR') AXES.forEach(k => { this._bufs[k].fill(0); });
  }
  onKeyUp()    {}
  onMouseMove() {}
}
