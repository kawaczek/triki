// static/triki.js — TrikiController (plain script, window.TrikiController)
(function() {
const NUS_SVC = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_RX  = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_TX  = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const START   = new Uint8Array([0x20,0x10,0x00,0xD0,0x07,0x68,0x00,0x03]);
const GYRO_S      = 1 / 131.0;
const ACCEL_S     = 1 / 2048.0;
const ACCEL_SCALE = 30;
const DEAD_ACCEL  = 1.0;
const DEAD_GYRO   = 1.5;

const CALIB_DEFAULTS = {
  tilt:  {hAxis:'ax', hSign:1, vAxis:'ay', vSign:1},
  swing: {hAxis:'gz', hSign:1, vAxis:'gx', vSign:1},
};

class TrikiController {
  constructor() {
    this.supported   = !!navigator.bluetooth;
    this.connected   = false;
    this.connecting  = false;
    this.name        = '';
    this.deviceId    = '';
    this.gx = 0; this.gy = 0; this.gz = 0;
    this.ax = 0; this.ay = 0; this.az = 0;
    this.scheme      = 'tilt';
    this.sensitivity = parseFloat(localStorage.getItem('triki_sensitivity') || '1.97');
    const _ix = localStorage.getItem('triki_invert_x');
    this.invertX     = _ix === null ? true : _ix === '1';
    this.invertY     = localStorage.getItem('triki_invert_y') === '1';
    this._btn        = false;
    this._btnEdge    = false;
    this._dev        = null;
    this._manualDisc = false;   // true gdy użytkownik rozłączył ręcznie
    this._reconTimer = null;
    this.onStatus    = null;
    // kalibracja v2: wektor 2D zamiast nazwy osi (obsługuje dowolną rotację kapsla)
    this._calibV2   = null;    // {cx,cy,rx,ry} — neutral + wektor "prawo"
    this._calibNeut = null;    // tymczasowe: neutral podczas kroku 1
    try { const s = localStorage.getItem('triki_calib_v2'); if (s) this._calibV2 = JSON.parse(s); } catch(_) {}
    this._rotDrift  = 0;       // offset gz ustawiany w chwili kalibracji (snapshot)
    this.autoInvert  = true;
    this._shaking    = false;  // poziom: czy trwa potrząsanie
    this._shakeEdge  = false;  // zbocze: jednorazowy tick po rozpoczęciu potrząsania
    this._demoTimer  = null;   // timer trybu demo (?demo=1)
  }

  // ── auto-connect do zapamiętanego urządzenia ──────────────
  async autoConnect() {
    if (!this.supported || this.connecting || this.connected) return false;
    if (!navigator.bluetooth.getDevices) return false;
    const savedId = localStorage.getItem('triki_last_id');
    if (!savedId) return false;
    try {
      const devices = await navigator.bluetooth.getDevices();
      const dev = devices.find(d => d.id === savedId);
      if (!dev) return false;
      this._dev        = dev;
      this.name        = dev.name || 'Triki';
      this.deviceId    = dev.id;
      this._manualDisc = false;
      this.connecting  = true;
      this._emit();                   // pokaż "Łączenie..." w UI
      await this._doConnect();
      return true;
    } catch(e) {
      this.connecting = false;
      this._emit();
      return false;
    }
  }

  // ── manualne wyszukiwanie przez dialog ────────────────────
  async connect() {
    if (!this.supported || this.connecting) return;
    this._manualDisc = false;
    this.connecting  = true;
    this._emit();
    try {
      this._dev = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'Triki' }],
        optionalServices: [NUS_SVC, 'battery_service', 'device_information'],
      });
      this.name     = this._dev.name || 'Triki';
      this.deviceId = this._dev.id;
      localStorage.setItem('triki_last_id', this._dev.id);
      await this._doConnect();
    } catch (e) {
      this.connecting = false;
      this._emit();
      if (e.name !== 'NotFoundError' && e.name !== 'NotAllowedError') console.warn('[BLE]', e.message);
      throw e;
    }
  }

  async _doConnect() {
    // usuń stary listener zanim dodamy nowy (zabezpieczenie przed duplikatami)
    if (this._dev._discListener) {
      this._dev.removeEventListener('gattserverdisconnected', this._dev._discListener);
    }
    this._dev._discListener = () => this._disc();
    this._dev.addEventListener('gattserverdisconnected', this._dev._discListener);

    const srv = await this._dev.gatt.connect();
    const svc = await srv.getPrimaryService(NUS_SVC);
    const tx  = await svc.getCharacteristic(NUS_TX);
    await tx.startNotifications();
    tx.addEventListener('characteristicvaluechanged', e => this._frame(e.target.value));
    const rx = await svc.getCharacteristic(NUS_RX);
    await rx.writeValue(START);
    this.connected  = true;
    this.connecting = false;
    clearTimeout(this._reconTimer);
    this._emit();
  }

  // ── auto-reconnect po zerwaniu połączenia ─────────────────
  _scheduleReconnect(delay = 3000) {
    clearTimeout(this._reconTimer);
    this._reconTimer = setTimeout(async () => {
      if (this.connected || this.connecting || !this._dev || this._manualDisc) return;
      try {
        this.connecting = true;
        this._emit();
        await this._doConnect();
      } catch(e) {
        this.connecting = false;
        this._emit();
        // exponential backoff: 3s → 6s → 12s → … max 30s
        this._scheduleReconnect(Math.min(delay * 2, 30000));
      }
    }, delay);
  }

  _disc() {
    const wasConn = this.connected;
    this.connected  = false;
    this.connecting = false;
    this.gx = this.gy = this.gz = 0;
    this.ax = this.ay = this.az = 0;
    this._btn = false; this._btnEdge = false;
    this._emit();
    // auto-reconnect jeśli rozłączenie było nieoczekiwane
    if (wasConn && !this._manualDisc) {
      this._scheduleReconnect(3000);
    }
  }

  disconnect() {
    this._manualDisc = true;
    clearTimeout(this._reconTimer);
    if (this._dev?.gatt?.connected) this._dev.gatt.disconnect();
  }

  // ── frame parser ──────────────────────────────────────────
  _frame(dv) {
    if (dv.byteLength < 14 || dv.getUint8(0) !== 0x22) return;
    const btn = dv.getUint8(1) === 0x01;
    if (btn && !this._btn) this._btnEdge = true;
    this._btn = btn;
    this.gx = dv.getInt16(2, true) * GYRO_S;
    this.gy = dv.getInt16(4, true) * GYRO_S;
    this.gz = dv.getInt16(6, true) * GYRO_S;
    this.ax = dv.getInt16(8,  true) * ACCEL_S;
    this.ay = dv.getInt16(10, true) * ACCEL_S;
    
    const oldFlipped = this.isFlipped;
    this.az = dv.getInt16(12, true) * ACCEL_S;
    if (this.isFlipped !== oldFlipped) {
      this._emit();
    }
    // detekcja potrząsania (edge-triggered)
    const g = Math.hypot(this.ax, this.ay, this.az);
    const isShaking = Math.abs(g - 1.0) > 0.35;
    if (isShaking && !this._shaking) this._shakeEdge = true;
    this._shaking = isShaking;
  }

  consumeClick()  { const v = this._btnEdge;  this._btnEdge  = false; return v; }
  consumeShake()  { const v = this._shakeEdge; this._shakeEdge = false; return v; }

  // ── tryb demo: symuluje sensor bez fizycznego kapsla ─────
  startDemo() {
    if (this._demoTimer) return;
    this.connected = true; this.name = 'DEMO'; this.deviceId = 'demo';
    let t = 0;
    this._demoTimer = setInterval(() => {
      t += 0.05;
      this.gx = Math.sin(t * 0.8) * 80;
      this.gz = Math.sin(t * 1.1) * 80;
      this.ax = Math.sin(t * 0.5) * 0.35;
      this.ay = Math.cos(t * 0.7) * 0.35;
      this.az = 1.0;
      // symulacja kliknięcia co ~3s
      const beat = Math.floor(t / (Math.PI * 2 / 0.8));
      if (beat !== this._demoBeat) { this._btnEdge = true; this._demoBeat = beat; }
    }, 50);
    this._demoBeat = 0;
    this._emit();
  }

  stopDemo() {
    if (!this._demoTimer) return;
    clearInterval(this._demoTimer); this._demoTimer = null;
    this.connected = false; this.name = ''; this.deviceId = '';
    this.gx = this.gy = this.gz = this.ax = this.ay = 0; this.az = 1;
    this._emit();
  }

  // ── kalibracja 2-krokowa (button-triggered) ───────────────
  // Krok 1: wywołaj gdy kapsel w neutralnej pozycji tuż przed kliknięciem
  calibrateNeutral() {
    this._calibNeut = { ax: this.ax, ay: this.ay };
    this._rotDrift  = this.gz;   // zero żyroskopu = co teraz pokazuje
  }

  // Krok 2: wywołaj gdy kapsel przechylony W PRAWO tuż przed kliknięciem
  // Zwraca true jeśli przechył był wystarczający (>= ~2°), false jeśli za mały
  calibrateRight() {
    if (!this._calibNeut) return false;
    const dx = this.ax - this._calibNeut.ax;
    const dy = this.ay - this._calibNeut.ay;
    const len = Math.hypot(dx, dy);
    if (len < 0.035) return false;   // ~2° minimalny przechył
    const rx = dx / len, ry = dy / len;
    this._calibV2 = { cx: this._calibNeut.ax, cy: this._calibNeut.ay, rx, ry };
    localStorage.setItem('triki_calib_v2', JSON.stringify(this._calibV2));
    this._calibNeut = null;
    return true;
  }

  // Usuwa kalibrację v2 (fallback do osi)
  clearCalibV2() {
    this._calibV2 = null;
    localStorage.removeItem('triki_calib_v2');
  }

  _calib() {
    const key = this.scheme === 'swing' ? 'triki_calib_swing' : 'triki_calib';
    try {
      return JSON.parse(localStorage.getItem(key) || 'null') || CALIB_DEFAULTS[this.scheme] || CALIB_DEFAULTS.tilt;
    } catch(_) { return CALIB_DEFAULTS[this.scheme] || CALIB_DEFAULTS.tilt; }
  }

  get isFlipped() {
    // az standardowo wynosi ~1.0 (dodatnie) gdy lezy guzikami do gory.
    // az wynosi ~-1.0 gdy jest odwrocony rewersem do gory.
    return this.az < -0.2;
  }

  get _ix() {
    let inv = this.invertX;
    if (this.isFlipped) {
      inv = !inv;
    }
    return inv ? -1 : 1;
  }

  get _iy() {
    let inv = this.invertY;
    if (this.isFlipped) {
      inv = !inv;
    }
    return inv ? -1 : 1;
  }

  GX(dz) {
    if (this.scheme === 'rotate') {
      return (Math.abs(this.gz) < DEAD_GYRO ? 0 : this.gz) * this.sensitivity * this._ix;
    }
    const c = this._calib();
    if (this.scheme === 'swing') {
      const v = c.hSign * this[c.hAxis];
      return (Math.abs(v) < (dz ?? DEAD_GYRO) ? 0 : v) * this.sensitivity * this._ix;
    }
    // tilt — użyj kalibracji v2 jeśli dostępna
    // GX = oś pionowa gry (góra/dół). Konwencja: +GX = dół.
    // = składowa prostopadła do wektora "prawo" (obrót CCW od prawej)
    if (this._calibV2) {
      const c2 = this._calibV2;
      const v = ((this.ax - c2.cx) * (-c2.ry) + (this.ay - c2.cy) * c2.rx) * ACCEL_SCALE;
      return (Math.abs(v) < (dz ?? DEAD_ACCEL) ? 0 : v) * this.sensitivity * this._ix;
    }
    const v = c.hSign * this[c.hAxis] * ACCEL_SCALE;
    return (Math.abs(v) < (dz ?? DEAD_ACCEL) ? 0 : v) * this.sensitivity * this._ix;
  }

  GZ(dz) {
    if (this.scheme === 'rotate') {
      return (Math.abs(this.gz) < DEAD_GYRO ? 0 : this.gz) * this.sensitivity * this._iy;
    }
    const c = this._calib();
    if (this.scheme === 'swing') {
      const v = c.vSign * this[c.vAxis];
      return (Math.abs(v) < (dz ?? DEAD_GYRO) ? 0 : v) * this.sensitivity * this._iy;
    }
    // tilt — użyj kalibracji v2 jeśli dostępna
    // GZ = oś pozioma gry. Konwencja: -GZ() = prawo (gry używają -GZ() jako poziom).
    // = -składowa wzdłuż wektora "prawo" (żeby -GZ > 0 przy przechyle w prawo)
    if (this._calibV2) {
      const c2 = this._calibV2;
      const v = -((this.ax - c2.cx) * c2.rx + (this.ay - c2.cy) * c2.ry) * ACCEL_SCALE;
      return (Math.abs(v) < (dz ?? DEAD_ACCEL) ? 0 : v) * this.sensitivity * this._iy;
    }
    const v = c.vSign * this[c.vAxis] * ACCEL_SCALE;
    return (Math.abs(v) < (dz ?? DEAD_ACCEL) ? 0 : v) * this.sensitivity * this._iy;
  }

  // auto-drift correction wbudowany na stałe (VeltoKit-style)
  ROT(dz) {
    const v = (this.gz - this._rotDrift) * this.sensitivity * this._ix;
    return Math.abs(v) < (dz ?? DEAD_GYRO) ? 0 : v;
  }

  setInvert(axis, on) {
    if (axis === 'x') { this.invertX = on; localStorage.setItem('triki_invert_x', on ? '1' : '0'); }
    else              { this.invertY = on; localStorage.setItem('triki_invert_y', on ? '1' : '0'); }
  }

  setSensitivity(v) {
    this.sensitivity = v;
    localStorage.setItem('triki_sensitivity', String(v));
  }

  setAutoInvert(on) {
    this.autoInvert = on;
  }

  _emit() { this.onStatus?.(); }
}

window.TrikiController = TrikiController;
})();
