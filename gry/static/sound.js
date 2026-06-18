// static/sound.js — wspólny syntezator dźwięku (ES module)
// Importuj w grach: import Sound from '../../static/sound.js';
// API: Sound.play('blip') | Sound.play('boom') | Sound.play('win') itp.

const Sound = (() => {
  let ctx = null;

  function init() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch(_) {}
    }
    if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function osc(freq, type, duration, vol = 0.08) {
    const c = init(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, c.currentTime);
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + duration);
  }

  function sweep(f0, f1, type, duration, vol = 0.07) {
    const c = init(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(f1, c.currentTime + duration);
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + duration);
  }

  function noise(duration, vol = 0.12, cutoff = 600) {
    const c = init(); if (!c) return;
    const sr = c.sampleRate;
    const buf = c.createBuffer(1, Math.ceil(sr * duration), sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const flt = c.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.setValueAtTime(cutoff, c.currentTime);
    flt.frequency.exponentialRampToValueAtTime(60, c.currentTime + duration);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    src.connect(flt); flt.connect(g); g.connect(c.destination);
    src.start(); src.stop(c.currentTime + duration);
  }

  const SOUNDS = {
    // UI
    blip:   () => osc(880, 'square', 0.06, 0.05),
    click:  () => osc(440, 'square', 0.05, 0.04),
    back:   () => sweep(440, 220, 'square', 0.1, 0.05),
    // Gry — akcje
    coin:   () => { osc(880, 'square', 0.08, 0.06); setTimeout(() => osc(1320, 'square', 0.1, 0.06), 80); },
    hit:    () => sweep(200, 60, 'square', 0.15, 0.1),
    laser:  () => sweep(600, 100, 'sawtooth', 0.15, 0.05),
    boom:   () => noise(0.3, 0.14, 400),
    pickup: () => sweep(300, 900, 'sine', 0.12, 0.07),
    fail:   () => sweep(400, 120, 'sawtooth', 0.4, 0.07),
    tick:   () => osc(800, 'square', 0.02, 0.03),
    woosh:  () => sweep(100, 800, 'sawtooth', 0.09, 0.05),
    win:    () => { [0,110,220,330].forEach((d,i) => setTimeout(() => osc(440 * Math.pow(1.26, i), 'square', 0.2, 0.07), d)); },
    shake:  () => noise(0.12, 0.1, 1200),
    bounce: () => sweep(300, 600, 'sine', 0.08, 0.06),
  };

  return {
    play(name) { try { SOUNDS[name]?.(); } catch(_) {} },
    // Prymitywy dla zaawansowanych gier
    osc, sweep, noise,
    init,
  };
})();

export default Sound;
