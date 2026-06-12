// static/gameutils.js — wspólne narzędzia dla gier (ES module)
// Importuj w grach przez ścieżkę względną: import { ... } from '../../static/gameutils.js';

export const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
export const rand  = (lo, hi) => lo + Math.random() * (hi - lo);
export const lerp  = (a, b, t) => a + (b - a) * t;
export const pick  = arr => arr[Math.floor(Math.random() * arr.length)];

// Subtelna siatka w tle gry
export function drawGrid(ctx, W, H, alpha = 0.035, step = 40) {
  ctx.save();
  ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.restore();
}

// Radialna poświata (kolor hex #rrggbb)
export function radialGlow(ctx, x, y, r, color, alpha = 0.4) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color + Math.round(alpha * 255).toString(16).padStart(2, '0'));
  g.addColorStop(1, color + '00');
  ctx.save();
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Dymek tekstowy na canvasie (tutorial, podpowiedzi)
export function drawHintBubble(ctx, x, y, text, opts = {}) {
  const fontSize = opts.fontSize || 13;
  ctx.save();
  ctx.font = `600 ${fontSize}px Outfit, sans-serif`;
  const w = ctx.measureText(text).width + 22;
  const h = fontSize + 14;
  ctx.fillStyle = opts.bg || 'rgba(10, 12, 22, 0.78)';
  ctx.strokeStyle = opts.border || 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = opts.color || 'rgba(255,255,255,0.92)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 1);
  ctx.restore();
}
