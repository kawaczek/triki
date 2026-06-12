import { clamp } from '../../static/gameutils.js';

class SoundEffects {
  constructor() {
    this.ctx = null;
  }
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (_) {}
  }
  tick(isNear, isExact) {
    this.init();
    if (!this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      
      const freq = isExact ? 1800 : (isNear ? 1350 : 850);
      const volume = isExact ? 0.22 : (isNear ? 0.12 : 0.04);
      const duration = isExact ? 0.06 : (isNear ? 0.035 : 0.015);
      
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(volume, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
      
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (_) {}
  }
  
  clack() {
    this.init();
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      [200, 310, 420].forEach(f => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, now);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        
        osc.start();
        osc.stop(now + 0.12);
      });
    } catch (_) {}
  }
  
  error() {
    this.init();
    if (!this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(110, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.18, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.35);
      
      osc.start();
      osc.stop(this.ctx.currentTime + 0.35);
    } catch (_) {}
  }
  
  victory() {
    this.init();
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((f, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, now + i * 0.1);
        gain.gain.setValueAtTime(0.15, now + i * 0.1);
        gain.gain.setValueAtTime(0.15, now + i * 0.1 + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.25);
        
        osc.start(now + i * 0.1);
        osc.stop(now + i * 0.1 + 0.25);
      });
    } catch (_) {}
  }
}

export default class SejfGame {
  constructor(canvas, ctx, triki, emit) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.triki = triki;
    this.emit = emit;
    this.running = false;
    this.W = canvas.width;
    this.H = canvas.height;
    
    this.sfx = new SoundEffects();
    
    this.resetGame();
  }
  
  resetGame() {
    this.dialAngle = 0;
    this.cumulativeAngle = 0;
    this.lastPos = 0;
    this.score = 0;
    this.timeElapsed = 0;
    
    // Generuj 3-cyfrowy kod sejfu (np. [35, 72, 18])
    this.code = [
      Math.floor(Math.random() * 80) + 10,
      Math.floor(Math.random() * 80) + 10,
      Math.floor(Math.random() * 80) + 10
    ];
    // Zabezpieczenie przed zbyt bliskimi liczbami obok siebie
    if (Math.abs(this.code[1] - this.code[0]) < 15) this.code[1] = (this.code[0] + 40) % 90 + 5;
    if (Math.abs(this.code[2] - this.code[1]) < 15) this.code[2] = (this.code[1] + 40) % 90 + 5;
    
    this.unlockedStages = 0; // 0, 1, 2, 3 (koniec)
    this.wrongAttempts = 0;
    
    this.victoryAnimTime = 0;
    this.showVictory = false;
    
    this._mx = 0.5;
    this._my = 0.5;
  }
  
  start(player) {
    this.player = player;
    this.resetGame();
    this.running = true;
    this.emit('stats', `Etap <b>1/3</b>`);
  }
  
  resize(W, H) {
    this.W = W;
    this.H = H;
  }
  
  getDistToTarget(pos) {
    if (this.unlockedStages >= 3) return 999;
    let target = this.code[this.unlockedStages];
    let dist = Math.abs(pos - target);
    if (dist > 50) dist = 100 - dist;
    return dist;
  }
  
  confirmPosition() {
    if (this.unlockedStages >= 3) return;
    
    let pos = Math.round(this.dialAngle / 3.6) % 100;
    if (pos < 0) pos += 100;
    
    let target = this.code[this.unlockedStages];
    let dist = Math.abs(pos - target);
    if (dist > 50) dist = 100 - dist;
    
    if (dist === 0) {
      this.unlockedStages++;
      this.sfx.clack();
      
      if (this.unlockedStages === 3) {
        this.sfx.victory();
        this.showVictory = true;
        // score: im szybciej tym lepiej (maksymalny czas 120s)
        const scoreVal = Math.max(10, 12000 - Math.floor(this.timeElapsed * 100));
        this.score = scoreVal;
        this.emit('stats', `<b>ZŁAMANY!</b> w ${(this.timeElapsed).toFixed(1)}s`);
      } else {
        this.emit('stats', `Etap <b>${this.unlockedStages + 1}/3</b>`);
      }
    } else {
      this.sfx.error();
      this.wrongAttempts++;
      // kara +5 sekund do ogólnego czasu
      this.timeElapsed += 5.0;
      this.emit('stats', `BŁĄD! +5s kary`);
    }
  }
  
  onMouseMove(nx, ny) {
    if (this.triki.connected || !this.running || this.showVictory) return;
    // Ruch myszki w poziomie obraca tarczę
    const diffX = nx - this._mx;
    this.dialAngle += diffX * 180; // czułość obrotu myszką
    this._mx = nx;
    this._my = ny;
  }
  
  onClick(nx, ny) {
    if (!this.running || this.showVictory) return;
    this.confirmPosition();
  }
  
  onKeyDown(code) {
    if (!this.running || this.showVictory) return;
    if (code === 'ArrowRight') {
      this.dialAngle += 3.6; // Obrót o 1 pozycję
    } else if (code === 'ArrowLeft') {
      this.dialAngle -= 3.6;
    } else if (code === 'Enter' || code === 'Space') {
      this.confirmPosition();
    }
  }
  
  update(dt) {
    if (!this.running) return;
    
    if (this.showVictory) {
      this.victoryAnimTime += dt;
      if (this.victoryAnimTime > 3000) {
        this.running = false;
        this.emit('end', { score: this.score });
      }
      return;
    }
    
    this.timeElapsed += dt / 1000;
    
    // Obsługa sterowania BLE kapslem
    if (this.triki.connected) {
      const rotVal = this.triki.ROT?.() ?? 0;
      // Zintegruj obrót w czasie
      this.cumulativeAngle += rotVal * (dt / 1000);
      this.dialAngle = -this.cumulativeAngle;
      
      // Kliknięcie guzika kapsla zatwierdza pozycję
      if (this.triki.consumeClick?.()) {
        this.confirmPosition();
      }
    }
    
    // Wyznacz pozycję 0-99 na tarczy i sprawdź czy zmienił się ząbek
    let pos = Math.round(this.dialAngle / 3.6) % 100;
    if (pos < 0) pos += 100;
    
    if (pos !== this.lastPos) {
      const dist = this.getDistToTarget(pos);
      const isExact = dist === 0;
      const isNear = dist <= 3;
      this.sfx.tick(isNear, isExact);
      this.lastPos = pos;
    }
  }
  
  draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);
    
    const cx = W / 2;
    const cy = H / 2 + H * 0.05;
    const radius = Math.min(W, H) * 0.31;
    
    // Tło gry
    ctx.save();
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, W, H);
    
    // Rysowanie drobnej metalowej siatki tła
    ctx.strokeStyle = 'rgba(255,255,255,0.015)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 30) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y = 0; y < H; y += 30) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
    ctx.restore();
    
    // Jeśli wygrana to animujemy rozchodzące się drzwi sejfu
    if (this.showVictory) {
      const animRatio = Math.min(1.0, this.victoryAnimTime / 1500);
      
      // Góry złota za drzwiami
      ctx.save();
      ctx.fillStyle = '#1b1710';
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
      
      // Złote monety
      ctx.fillStyle = '#f59e0b';
      for (let i = 0; i < 40; i++) {
        let mx = cx - radius * 0.7 + (i * 9) % (radius * 1.4);
        let my = cy + radius * 0.8 - (i * 4) % (radius * 0.5) - (Math.sin(i) * 10);
        ctx.beginPath();
        ctx.arc(mx, my, 7 + (i % 3), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#d97706';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      
      // Skrzynia skarbów
      ctx.fillStyle = '#78350f';
      ctx.fillRect(cx - 30, cy + 10, 60, 40);
      ctx.strokeStyle = '#451a03';
      ctx.lineWidth = 3;
      ctx.strokeRect(cx - 30, cy + 10, 60, 40);
      
      // Złote okucia na skrzyni
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(cx - 28, cy + 10, 6, 40);
      ctx.fillRect(cx + 22, cy + 10, 6, 40);
      ctx.restore();
      
      // Lewe drzwi sejfu (odsuwane w lewo)
      ctx.save();
      ctx.translate(-animRatio * radius, 0);
      ctx.fillStyle = '#374151';
      ctx.fillRect(cx - radius, cy - radius, radius, radius * 2);
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 4;
      ctx.strokeRect(cx - radius, cy - radius, radius, radius * 2);
      // Panel ozdobny lewy
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(cx - radius + 12, cy - radius + 12, radius - 24, radius * 2 - 24);
      ctx.restore();
      
      // Prawe drzwi sejfu (odsuwane w prawo)
      ctx.save();
      ctx.translate(animRatio * radius, 0);
      ctx.fillStyle = '#374151';
      ctx.fillRect(cx, cy - radius, radius, radius * 2);
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 4;
      ctx.strokeRect(cx, cy - radius, radius, radius * 2);
      // Panel ozdobny prawy
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(cx + 12, cy - radius + 12, radius - 24, radius * 2 - 24);
      ctx.restore();
      
      // Tekst wygranej
      if (animRatio >= 0.7) {
        ctx.save();
        ctx.fillStyle = '#22c55e';
        ctx.font = `bold ${Math.round(W * 0.05)}px Outfit, sans-serif`;
        ctx.textAlign = 'center';
        ctx.shadowBlur = 12;
        ctx.shadowColor = '#22c55e';
        ctx.fillText("SEJF ZŁAMANY! 🏆", cx, cy - 25);
        ctx.restore();
        
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = `bold ${Math.round(W * 0.033)}px Outfit, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(`Czas złamania: ${(this.timeElapsed).toFixed(1)}s`, cx, cy + 25);
      }
      return;
    }
    
    // Rysowanie tarczy sejfu
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    let grad = ctx.createRadialGradient(cx, cy, radius * 0.3, cx, cy, radius);
    grad.addColorStop(0, '#2e3138');
    grad.addColorStop(0.7, '#1b1c20');
    grad.addColorStop(1, '#0e0f12');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#1e2025';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.restore();
    
    // Rysowanie podziałki i liczb tarczy (obracające się wraz z tłem)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.dialAngle * Math.PI / 180);
    
    for (let i = 0; i < 100; i++) {
      let angle = (i * 3.6 - 90) * Math.PI / 180;
      let isMajor = i % 5 === 0;
      let isText = i % 10 === 0;
      let len = isMajor ? radius * 0.075 : radius * 0.038;
      
      let startR = radius - len - 4;
      let endR = radius - 4;
      
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * startR, Math.sin(angle) * startR);
      ctx.lineTo(Math.cos(angle) * endR, Math.sin(angle) * endR);
      ctx.strokeStyle = isMajor ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.22)';
      ctx.lineWidth = isMajor ? 1.5 : 1;
      ctx.stroke();
      
      if (isText) {
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = `${Math.round(radius * 0.08)}px Outfit, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        let textR = radius - radius * 0.17;
        ctx.translate(Math.cos(angle) * textR, Math.sin(angle) * textR);
        ctx.rotate(angle + Math.PI / 2);
        ctx.fillText(i.toString(), 0, 0);
        ctx.restore();
      }
    }
    ctx.restore();
    
    // Rysowanie centralnego uchwytu pokrętła (nie obraca się w tym rysowaniu, co nadaje ładny efekt głębi)
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.42, 0, Math.PI * 2);
    let gradInner = ctx.createRadialGradient(cx - radius * 0.05, cy - radius * 0.05, 0, cx, cy, radius * 0.42);
    gradInner.addColorStop(0, '#4a4d55');
    gradInner.addColorStop(1, '#202125');
    ctx.fillStyle = gradInner;
    ctx.fill();
    ctx.strokeStyle = '#121316';
    ctx.lineWidth = 3;
    ctx.stroke();
    
    // Rysowanie wypustki na centralnym pokrętle (obracającej się wraz z tłem)
    ctx.translate(cx, cy);
    ctx.rotate(this.dialAngle * Math.PI / 180);
    ctx.fillStyle = '#151619';
    ctx.beginPath();
    ctx.roundRect(-radius * 0.05, -radius * 0.35, radius * 0.1, radius * 0.7, radius * 0.02);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    
    // Czerwony statyczny wskaźnik na górze
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(cx, cy - radius - 5);
    ctx.lineTo(cx - 7, cy - radius - 18);
    ctx.lineTo(cx + 7, cy - radius - 18);
    ctx.closePath();
    ctx.fill();
    
    // Rysowanie 3 diod LED u góry
    const ledSpacing = 40;
    const startLedX = cx - ledSpacing;
    const ledY = cy - radius - 35;
    
    for (let i = 0; i < 3; i++) {
      let ledX = startLedX + i * ledSpacing;
      let isUnlocked = this.unlockedStages > i;
      
      ctx.save();
      ctx.beginPath();
      ctx.arc(ledX, ledY, 7, 0, Math.PI * 2);
      
      // Blask włączonej diody
      ctx.shadowBlur = 10;
      ctx.shadowColor = isUnlocked ? '#22c55e' : '#ef4444';
      ctx.fillStyle = isUnlocked ? '#22c55e' : '#ef4444';
      ctx.fill();
      
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
    
    // Wskazówka i kierunek dla gracza
    let posText = Math.round(this.dialAngle / 3.6) % 100;
    if (posText < 0) posText += 100;
    
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(W * 0.04)}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(posText.toString().padStart(2, '0'), cx, cy - radius * 0.58);
    
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = `${Math.round(W * 0.02)}px Outfit, sans-serif`;
    ctx.fillText("POZYCJA", cx, cy - radius * 0.58 - 18);
    
    // Instrukcja tekstowa u dołu
    let hintText = "";
    let hintColor = "#a855f7";
    if (this.unlockedStages === 0) {
      hintText = "➡️ Kręć w PRAWO do pierwszej zapadki";
      hintColor = "#3b82f6";
    } else if (this.unlockedStages === 1) {
      hintText = "⬅️ Kręć w LEWO do drugiej zapadki";
      hintColor = "#f59e0b";
    } else if (this.unlockedStages === 2) {
      hintText = "➡️ Kręć w PRAWO do ostatniej zapadki";
      hintColor = "#ef4444";
    }
    
    ctx.fillStyle = hintColor;
    ctx.font = `bold ${Math.round(W * 0.03)}px Outfit, sans-serif`;
    ctx.fillText(hintText, cx, cy + radius + 30);
    
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = `${Math.round(W * 0.025)}px Outfit, sans-serif`;
    ctx.fillText("🎧 Wsłuchaj się w pisk i wciśnij guzik kapsla!", cx, cy + radius + 55);
    
    // Wyświetlanie upływającego czasu
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = `${Math.round(W * 0.028)}px Outfit, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(`Czas: ${this.timeElapsed.toFixed(1)}s`, 20, H - 20);
    
    if (this.wrongAttempts > 0) {
      ctx.fillStyle = '#ef4444';
      ctx.textAlign = 'right';
      ctx.fillText(`Kary: +${this.wrongAttempts * 5}s`, W - 20, H - 20);
    }
  }
  
  drawIdle() {
    this.draw();
    const { ctx, W, H } = this;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, 0, W, H);
    
    ctx.fillStyle = '#22c55e';
    ctx.font = `bold ${Math.round(W * 0.06)}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText("SEJF KASIARZA", W / 2, H / 2 - 30);
    
    ctx.fillStyle = '#ffffff';
    ctx.font = `${Math.round(W * 0.03)}px Outfit, sans-serif`;
    ctx.fillText("Złam 3-cyfrowy kod sejfu wsłuchując się w kliknięcia zamka.", W / 2, H / 2 + 10);
    ctx.fillText("Im bliżej celu, tym pisk staje się wyższy.", W / 2, H / 2 + 40);
    ctx.fillText("Wciśnij START i zakręć kapslem!", W / 2, H / 2 + 80);
    ctx.restore();
  }
  
  destroy() {
    this.running = false;
  }
}
