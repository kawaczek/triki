// static/app.js — Triki Gry main app (plain script, requires triki.js loaded first)

// ── constants ────────────────────────────────────────────
const COLORS = ['#22c55e','#3b82f6','#a855f7','#ef4444','#f59e0b'];
const COLOR_NAMES = ['Zielony','Niebieski','Fioletowy','Czerwony','Żółty'];
const LS_KEY = 'triki_player';

// ── state ────────────────────────────────────────────────
const triki = new window.TrikiController();
let player      = null;    // {nick, color, deviceId}
let games       = [];      // from /api/games
let current     = null;    // {meta, instance}
let rafId       = null;
let lastT       = 0;
let _activeTag  = '';      // tab filter

// ── DOM refs ─────────────────────────────────────────────
const $ = id => document.getElementById(id);
const hub        = $('hub');
const gameView   = $('game-view');
const canvas     = $('game-canvas');
const ctx        = canvas.getContext('2d');

// BLE panel
const blePanel   = $('ble-panel');
const bleLabel   = $('ble-label');
const bleSub     = $('ble-sub');
const btnBle     = $('btn-ble');
const gyroXFill  = $('gyro-x-fill');
const gyroZFill  = $('gyro-z-fill');

// Nick modal
const nickModal  = $('nick-modal');
const nickInput  = $('nick-input');
const colorPick  = $('color-picker');
const btnSaveNick= $('btn-save-nick');
const modalDevice= $('modal-device');

// Hub
const playerPanel= $('player-panel');
const gameCards  = $('game-cards');

// Game view
const titleText  = $('game-title-text');
const bleCh      = $('game-ble-chip');
const bleChName  = $('game-ble-name');
const statsArea  = $('game-stats-area');
const btnBack    = $('btn-back');

// Overlays
const ovStart    = $('ov-start');
const ovEnd      = $('ov-end');
const btnStart   = $('btn-start');
const btnMenu    = $('btn-menu');
const btnRestart = $('btn-restart');

// ════════════════════════════════════════════════════════
// PLAYER MANAGER
// ════════════════════════════════════════════════════════
function loadPlayer() {
  try { player = JSON.parse(localStorage.getItem(LS_KEY)); } catch(_) {}
}

function savePlayer(p) {
  player = p;
  localStorage.setItem(LS_KEY, JSON.stringify(p));
  fetch('/api/players', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      device_id : p.deviceId,
      nick      : p.nick,
      color     : p.color,
      triki_name: triki.connected ? triki.name : (p.trikiName || null),
    }),
  }).catch(() => {});
}

function renderPlayerPanel() {
  if (!player) { playerPanel.innerHTML = ''; return; }
  playerPanel.innerHTML = `
    <div class="player-chip" style="--chip-color:${player.color}">
      <div class="chip-dot" style="background:${player.color}"></div>
      <span class="chip-nick">${esc(player.nick)}</span>
      <button class="chip-edit" title="Zmień profil" onclick="window._app.editProfile()">✏️</button>
    </div>`;
}

// ── nick modal ────────────────────────────────────────────
let _colorSelected = COLORS[0];

function buildColorPicker() {
  colorPick.innerHTML = '';
  COLORS.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'color-btn' + (c === _colorSelected ? ' selected' : '');
    b.style.background = c;
    b.title = COLOR_NAMES[i];
    b.onclick = () => {
      _colorSelected = c;
      colorPick.querySelectorAll('.color-btn').forEach(x => x.classList.remove('selected'));
      b.classList.add('selected');
    };
    colorPick.appendChild(b);
  });
}

function openNickModal(deviceName, deviceId) {
  modalDevice.textContent = deviceName ? `Urządzenie: ${deviceName}` : '';
  nickInput.value = player?.nick || '';
  _colorSelected  = player?.color || COLORS[0];
  buildColorPicker();
  nickModal.classList.remove('hidden');
  nickInput.focus();
  btnSaveNick.onclick = () => {
    const nick = nickInput.value.trim();
    if (!nick) { nickInput.focus(); return; }
    savePlayer({nick, color: _colorSelected, deviceId: deviceId || (player?.deviceId || 'local')});
    nickModal.classList.add('hidden');
    renderPlayerPanel();
  };
  nickInput.onkeydown = e => { if (e.key === 'Enter') btnSaveNick.onclick(); };
}

function editProfile() {
  openNickModal(triki.connected ? triki.name : null, triki.connected ? triki.deviceId : player?.deviceId);
}

// ════════════════════════════════════════════════════════
// SETTINGS MODAL (czułość, odwracanie osi, kalibracja)
// ════════════════════════════════════════════════════════
const setModal   = $('settings-modal');
const setSens    = $('set-sens');
const setSensVal = $('set-sens-val');
const setInvX    = $('set-invx');
const setInvY    = $('set-invy');
let _setPausedGame = false;

function openSettings() {
  // pauza gry, gdy ustawienia otwarte w trakcie rozgrywki
  _setPausedGame = !!(current?.inst?.running && rafId);
  if (_setPausedGame) stopLoop();

  setSens.value = Math.round(triki.sensitivity * 100);
  setSensVal.textContent = setSens.value + '%';
  setInvX.checked = triki.invertX;
  setInvY.checked = triki.invertY;
  setModal.classList.remove('hidden');
}

function closeSettings() {
  setModal.classList.add('hidden');
  if (_setPausedGame) { startLoop(); _setPausedGame = false; }
}

setSens.addEventListener('input', () => {
  setSensVal.textContent = setSens.value + '%';
  triki.setSensitivity(parseInt(setSens.value) / 100);
  // synchronizuj suwak w hubie
  const hubSlider = $('sens-slider'), hubVal = $('sens-val');
  if (hubSlider) { hubSlider.value = setSens.value; hubVal.textContent = setSens.value + '%'; }
});
setInvX.addEventListener('change', () => triki.setInvert('x', setInvX.checked));
setInvY.addEventListener('change', () => triki.setInvert('y', setInvY.checked));
$('btn-set-close').addEventListener('click', closeSettings);
$('btn-set-calib').addEventListener('click', async () => {
  closeSettings();
  await startCalib();
});
setModal.addEventListener('click', e => { if (e.target === setModal) closeSettings(); });
$('btn-hub-settings').addEventListener('click', openSettings);
$('btn-game-settings').addEventListener('click', openSettings);

// ════════════════════════════════════════════════════════
// WAKE LOCK
// ════════════════════════════════════════════════════════
let _wakeLock = null;
async function _requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try { _wakeLock = await navigator.wakeLock.request('screen'); } catch(_) {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') _requestWakeLock();
});

// ════════════════════════════════════════════════════════
// CALIBRATION
// ════════════════════════════════════════════════════════
function _renderCalibBtn() {
  if (document.getElementById('calib-btn-wrap')) return;
  const wrap = document.createElement('div');
  wrap.id = 'calib-btn-wrap';
  wrap.style.cssText = 'margin-top:10px;display:flex;flex-direction:column;gap:6px';

  const btnStyle = 'width:100%;padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.05);color:rgba(255,255,255,.7);font-size:12px;cursor:pointer;font-family:Outfit,sans-serif';

  const b1 = document.createElement('button');
  b1.id = 'btn-calib';
  b1.style.cssText = btnStyle;
  b1.textContent = '🎯 Skalibruj kapsla';
  b1.addEventListener('click', () => startCalib());

  const b2 = document.createElement('button');
  b2.style.cssText = btnStyle + ';color:rgba(100,200,255,.75);border-color:rgba(100,200,255,.25)';
  b2.textContent = '🔬 Pełna diagnostyka sensorów';
  b2.addEventListener('click', () => startFullDiag());

  wrap.appendChild(b1);
  wrap.appendChild(b2);
  blePanel.appendChild(wrap);
}

// sample both gyro and accel over ms milliseconds
async function _sample(ms) {
  const gA = {gx:0,gy:0,gz:0}, gD = {gx:0,gy:0,gz:0};
  const aA = {ax:0,ay:0,az:0}, aD = {ax:0,ay:0,az:0};
  let n = 0;
  return new Promise(resolve => {
    const end = Date.now() + ms;
    const iv = setInterval(() => {
      if (!triki.connected || Date.now() >= end) {
        clearInterval(iv);
        const r = {};
        ['gx','gy','gz'].forEach(k => { r[k] = n ? gD[k]/n : 0; r[k+'_abs'] = n ? gA[k]/n : 0; });
        ['ax','ay','az'].forEach(k => { r[k] = n ? aD[k]/n : 0; r[k+'_abs'] = n ? aA[k]/n : 0; });
        resolve(r);
      } else {
        ['gx','gy','gz'].forEach(k => { gA[k]+=Math.abs(triki[k]); gD[k]+=triki[k]; });
        ['ax','ay','az'].forEach(k => { aA[k]+=Math.abs(triki[k]); aD[k]+=triki[k]; });
        n++;
      }
    }, 40);
  });
}

// find dominant axis among gyro or accel keys (prefix 'g' or 'a')
function _dominant(s, prefix, exclude) {
  const keys = [prefix+'x', prefix+'y', prefix+'z'].filter(k => k !== exclude);
  const best = keys.reduce((a,b) => s[a+'_abs'] > s[b+'_abs'] ? a : b);
  return {axis: best, sign: s[best] >= 0 ? 1 : -1, strength: s[best+'_abs']};
}

function startCalib() {
  return new Promise(resolve => {
    if (!triki.connected) { showToast('Najpierw podłącz kapsla'); resolve(null); return; }

    triki.consumeClick();  // flush any pending click — krok nie może odpalić się sam

    const ov = document.createElement('div');
    ov.style.cssText = [
      'position:fixed;inset:0;background:rgba(6,8,16,.97);z-index:10000',
      'display:flex;flex-direction:column;align-items:center;justify-content:center',
      'padding:32px;gap:10px;text-align:center;font-family:Outfit,sans-serif',
    ].join(';');
    ov.innerHTML = `
      <div id="_c_icon" style="font-size:56px;line-height:1.1"></div>
      <div id="_c_step" style="font-size:10px;color:rgba(255,255,255,.3);letter-spacing:2.5px;text-transform:uppercase">KALIBRACJA</div>
      <div id="_c_msg"  style="font-size:19px;font-weight:800;color:#fff;max-width:280px;line-height:1.25"></div>
      <div id="_c_sub"  style="font-size:12px;color:rgba(255,255,255,.42);max-width:260px;line-height:1.5"></div>
      <canvas id="_c_cv" width="140" height="140" style="flex-shrink:0;margin:2px 0"></canvas>
      <div id="_c_tval" style="font-size:11px;color:rgba(255,255,255,.4);font-family:monospace;min-height:16px;letter-spacing:.5px"></div>
      <div style="width:220px;height:4px;background:rgba(255,255,255,.08);border-radius:2px;overflow:hidden">
        <div id="_c_prog" style="height:100%;width:0%;background:#22c55e;transition:width .35s ease"></div>
      </div>
      <div id="_c_warn" style="font-size:12px;color:#f59e0b;font-weight:600;min-height:18px"></div>
      <button id="_c_skip" style="
        margin-top:4px;padding:9px 26px;border-radius:10px;
        border:1px solid rgba(255,255,255,.15);background:transparent;
        color:rgba(255,255,255,.32);font-size:12px;font-family:Outfit,sans-serif;
        cursor:pointer;letter-spacing:.5px;
      ">POMIŃ</button>
    `;
    document.body.appendChild(ov);

    const iconEl  = ov.querySelector('#_c_icon');
    const stepEl  = ov.querySelector('#_c_step');
    const msgEl   = ov.querySelector('#_c_msg');
    const subEl   = ov.querySelector('#_c_sub');
    const progEl  = ov.querySelector('#_c_prog');
    const warnEl  = ov.querySelector('#_c_warn');
    const tvalEl  = ov.querySelector('#_c_tval');
    const cv      = ov.querySelector('#_c_cv');
    const cc      = cv.getContext('2d');

    const SZ     = 140;   // canvas px
    const CX     = SZ / 2;
    const CY     = SZ / 2;
    const RADIUS = 60;    // okrąg główny
    const SCALE  = 110;   // px per 1g
    const GOOD_G = 0.15;  // zalecany przechył

    let rafId;
    let currentStep = 1;
    let btnReady = false;

    function finish(success) {
      cancelAnimationFrame(rafId);
      ov.remove();
      resolve(success ? triki._calibV2 : null);
    }

    ov.querySelector('#_c_skip').onclick = () => finish(false);

    function showStep1() {
      currentStep = 1;
      btnReady = false;
      iconEl.textContent = '🤚';
      stepEl.textContent = 'KROK 1 / 2  ·  KALIBRACJA';
      msgEl.textContent  = 'Trzymaj kapsla jak chcesz grać';
      subEl.textContent  = 'Ustaw kapsel w naturalnej pozycji trzymania, potem wciśnij przycisk';
      progEl.style.width = '0%';
      warnEl.textContent = '';
    }

    function showStep2() {
      currentStep = 2;
      btnReady = false;
      iconEl.textContent = '➡️';
      stepEl.textContent = 'KROK 2 / 2  ·  KALIBRACJA';
      msgEl.textContent  = 'Przechyl mocno W PRAWO';
      subEl.textContent  = 'Wciśnij przycisk gdy kropka jest za okręgiem';
      progEl.style.width = '50%';
      warnEl.textContent = '';
    }

    function showDone() {
      iconEl.textContent = '✅';
      stepEl.textContent = 'GOTOWE!';
      msgEl.textContent  = 'Kalibracja zapisana';
      subEl.textContent  = 'Zaczynamy grę…';
      progEl.style.width = '100%';
      warnEl.textContent = '';
    }

    function drawTiltViz() {
      cc.clearRect(0, 0, SZ, SZ);

      const nx = triki._calibNeut?.ax ?? 0;
      const ny = triki._calibNeut?.ay ?? 0;
      const vx = currentStep === 1 ? triki.ax : triki.ax - nx;
      const vy = currentStep === 1 ? triki.ay : triki.ay - ny;
      const len = Math.hypot(vx, vy);

      // tło okręgu
      cc.beginPath();
      cc.arc(CX, CY, RADIUS, 0, Math.PI * 2);
      cc.strokeStyle = 'rgba(255,255,255,0.18)';
      cc.lineWidth = 1.5;
      cc.stroke();
      cc.fillStyle = 'rgba(255,255,255,0.03)';
      cc.fill();

      // krzyż
      cc.strokeStyle = 'rgba(255,255,255,0.12)';
      cc.lineWidth = 1;
      cc.beginPath(); cc.moveTo(CX - RADIUS, CY); cc.lineTo(CX + RADIUS, CY); cc.stroke();
      cc.beginPath(); cc.moveTo(CX, CY - RADIUS); cc.lineTo(CX, CY + RADIUS); cc.stroke();

      // okrąg docelowy (krok 2)
      if (currentStep === 2) {
        const rd = GOOD_G * SCALE;
        const good = len >= GOOD_G;
        cc.beginPath();
        cc.arc(CX, CY, rd, 0, Math.PI * 2);
        cc.strokeStyle = good ? 'rgba(34,197,94,0.6)' : 'rgba(239,68,68,0.6)';
        cc.lineWidth = 1.5;
        cc.setLineDash([4, 4]);
        cc.stroke();
        cc.setLineDash([]);
      }

      // pozycja kropki (zaciśnięta do okręgu)
      const rawX = CX + vx * SCALE;
      const rawY = CY + vy * SCALE;
      const d = Math.hypot(rawX - CX, rawY - CY);
      const rim = RADIUS - 8;
      const px = d > rim ? CX + (rawX - CX) / d * rim : rawX;
      const py = d > rim ? CY + (rawY - CY) / d * rim : rawY;

      // poświata
      const dotColor = currentStep === 1 ? '#3b82f6'
                     : len >= GOOD_G   ? '#22c55e'
                     : len >= 0.05     ? '#f59e0b'
                                       : '#ef4444';
      const grd = cc.createRadialGradient(px, py, 0, px, py, 14);
      grd.addColorStop(0, dotColor);
      grd.addColorStop(1, dotColor + '00');
      cc.beginPath(); cc.arc(px, py, 14, 0, Math.PI * 2);
      cc.fillStyle = grd; cc.fill();

      // kropka
      cc.beginPath(); cc.arc(px, py, 7, 0, Math.PI * 2);
      cc.fillStyle = dotColor; cc.fill();

      // wartości
      if (currentStep === 2) {
        const pct = Math.min(100, (len / GOOD_G) * 100);
        tvalEl.textContent = `siła: ${pct.toFixed(0)}%  (${len.toFixed(3)}g)`;
      } else {
        tvalEl.textContent = `ax ${vx >= 0 ? '+' : ''}${vx.toFixed(3)}  ay ${vy >= 0 ? '+' : ''}${vy.toFixed(3)}`;
      }
    }

    function tick() {
      drawTiltViz();
      if (!btnReady) { btnReady = true; triki.consumeClick(); rafId = requestAnimationFrame(tick); return; }

      if (triki.consumeClick()) {
        if (currentStep === 1) {
          triki.calibrateNeutral();
          showStep2();
        } else {
          const ok = triki.calibrateRight();
          if (!ok) {
            warnEl.textContent = '⚠️ Za mały przechył — poczekaj aż kropka wyjdzie za okrąg';
            navigator.vibrate?.([40, 80, 40]);
          } else {
            showDone();
            setTimeout(() => finish(true), 800);
            return;
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    }

    showStep1();
    rafId = requestAnimationFrame(tick);
  });
}

// ════════════════════════════════════════════════════════
// FULL SENSOR DIAGNOSTICS
// ════════════════════════════════════════════════════════
async function startFullDiag() {
  if (!triki.connected) { showToast('Najpierw podłącz kapsla'); return; }
  triki.consumeClick();

  const STEPS = [
    { id:'neutral',  emoji:'🤚', label:'NEUTRAL',         msg:'Trzymaj kapsla NIERUCHOMO',                  sub:'Twoja naturalna pozycja trzymania w grze' },
    { id:'right',    emoji:'➡️', label:'PRAWO',            msg:'Przechyl mocno W PRAWO',                     sub:'Trzymaj pochylony ~30° przez cały pomiar' },
    { id:'left',     emoji:'⬅️', label:'LEWO',             msg:'Przechyl mocno W LEWO',                      sub:'Trzymaj pochylony ~30° przez cały pomiar' },
    { id:'fwd',      emoji:'⬆️', label:'DO PRZODU',        msg:'Przechyl KU SOBIE',                          sub:'Górna część kapsla ku twojej twarzy' },
    { id:'back',     emoji:'⬇️', label:'DO TYŁU',          msg:'Przechyl OD SIEBIE',                         sub:'Górna część kapsla od ciebie' },
    { id:'rot_cw',   emoji:'🔃', label:'OBRÓT CW',         msg:'Obracaj powoli W PRAWO',                     sub:'Jak przykręcanie śruby — płynny ruch przez cały pomiar' },
    { id:'rot_ccw',  emoji:'🔄', label:'OBRÓT CCW',        msg:'Obracaj powoli W LEWO',                      sub:'Jak odkręcanie śruby — płynny ruch przez cały pomiar' },
    // Ruchy translacyjne (liniowe przyspieszenie) — mierzymy peak, nie średnią
    { id:'lift',     emoji:'🔼', label:'PODNIEŚ',          msg:'Szybko UNIEŚ kapsel do góry i wróć',         sub:'Wyraźny, szybki ruch pionowy — powtórz 2-3× w ciągu 1.5 sek.', peak:true },
    { id:'drop',     emoji:'🔽', label:'OPUŚĆ',            msg:'Szybko OPUŚĆ kapsel w dół i wróć',           sub:'Wyraźny, szybki ruch pionowy w dół — powtórz 2-3×', peak:true },
    { id:'slide_r',  emoji:'↔️', label:'PRZESUŃ PRAWO',    msg:'Przesuń kapsel SZYBKO W PRAWO po stole',     sub:'Jak pchnięcie po blacie — szybko, powtórz 2-3×', peak:true },
    { id:'slide_fwd',emoji:'⬆↔', label:'PRZESUŃ DO PRZODU',msg:'Przesuń kapsel DO PRZODU po stole',         sub:'Od siebie po blacie — szybko, powtórz 2-3×', peak:true },
    { id:'button',   emoji:'🔘', label:'PRZYCISK',          msg:'Wciśnij i puść przycisk na kapslu',          sub:'Tylko jeden klik', btn:true },
  ];
  const RECORD_MS = 1500;
  const AXES6 = ['ax','ay','az','gx','gy','gz'];
  const AXES_COL = {ax:'#22c55e',ay:'#3b82f6',az:'#a855f7',gx:'#f59e0b',gy:'#ef4444',gz:'#06b6d4'};
  const stepResults = {};

  // ── overlay ───────────────────────────────────────────
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(6,8,16,.99);z-index:10000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px 22px;gap:10px;font-family:Outfit,sans-serif;overflow:hidden';
  ov.innerHTML = `
    <div id="_d_hdr" style="text-align:center;width:100%;max-width:360px">
      <div id="_d_lbl" style="font-size:9px;color:rgba(255,255,255,.28);letter-spacing:2px;text-transform:uppercase;margin-bottom:2px">DIAGNOSTYKA KAPSLA</div>
      <div id="_d_ico" style="font-size:52px;line-height:1.15">🔬</div>
      <div id="_d_msg" style="font-size:18px;font-weight:800;color:#fff;line-height:1.25;margin-top:2px"></div>
      <div id="_d_sub" style="font-size:12px;color:rgba(255,255,255,.42);margin-top:4px;line-height:1.4;max-width:280px;margin:4px auto 0"></div>
    </div>
    <div style="width:100%;max-width:320px;height:3px;background:rgba(255,255,255,.07);border-radius:2px;overflow:hidden">
      <div id="_d_prog" style="height:100%;width:0%;background:#22c55e;transition:width .08s linear;border-radius:2px"></div>
    </div>
    <div id="_d_warn" style="font-size:12px;color:#f59e0b;font-weight:600;min-height:16px;text-align:center"></div>
    <!-- Live sensor bars + tilt canvas -->
    <div id="_d_live" style="width:100%;max-width:320px;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:11px 14px">
      <div style="color:rgba(255,255,255,.25);font-size:8px;letter-spacing:1.5px;margin-bottom:7px">LIVE SENSORY</div>
      <div style="display:flex;gap:12px;align-items:center">
        <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center">
          <canvas id="_d_cv" width="90" height="90"></canvas>
          <div id="_d_tval" style="font-size:9px;color:rgba(255,255,255,.28);font-family:monospace;margin-top:3px;text-align:center;white-space:nowrap"></div>
        </div>
        <div id="_d_bars" style="flex:1;min-width:0"></div>
      </div>
    </div>
    <!-- Results table (hidden until end) -->
    <div id="_d_res" style="display:none;width:100%;max-width:360px;overflow-x:auto;max-height:45vh;overflow-y:auto"></div>
    <div id="_d_ctr" style="font-size:10px;color:rgba(255,255,255,.18);letter-spacing:.5px"></div>
    <div style="display:flex;gap:10px">
      <button id="_d_done" style="display:none;padding:10px 28px;border-radius:10px;border:none;background:#22c55e;color:#000;font-weight:800;font-size:14px;cursor:pointer;font-family:Outfit,sans-serif">Zamknij</button>
      <button id="_d_cancel" style="padding:9px 22px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:transparent;color:rgba(255,255,255,.3);font-size:12px;cursor:pointer;font-family:Outfit,sans-serif">ANULUJ</button>
    </div>`;
  document.body.appendChild(ov);

  const lblEl   = ov.querySelector('#_d_lbl');
  const icoEl   = ov.querySelector('#_d_ico');
  const msgEl   = ov.querySelector('#_d_msg');
  const subEl   = ov.querySelector('#_d_sub');
  const progEl  = ov.querySelector('#_d_prog');
  const warnEl  = ov.querySelector('#_d_warn');
  const liveEl  = ov.querySelector('#_d_live');
  const barsEl  = ov.querySelector('#_d_bars');
  const resEl   = ov.querySelector('#_d_res');
  const ctrEl   = ov.querySelector('#_d_ctr');
  const btnDone = ov.querySelector('#_d_done');
  const btnCancel = ov.querySelector('#_d_cancel');
  const diagCv  = ov.querySelector('#_d_cv');
  const diagCc  = diagCv.getContext('2d');
  const diagTval= ov.querySelector('#_d_tval');

  const D_SZ = 90, D_CX = 45, D_CY = 45, D_R = 38, D_SCALE = 72, D_GOOD = 0.15;
  const TILT_STEPS = new Set(['neutral','right','left','fwd','back']);

  function drawDiagTilt(stepId) {
    diagCc.clearRect(0, 0, D_SZ, D_SZ);
    const neut = stepResults.neutral?.mean;
    const nx = neut?.ax ?? 0, ny = neut?.ay ?? 0;
    // dla kroków przechyłu: delta od neutral; reszta: absolutne
    const useDelta = TILT_STEPS.has(stepId) && neut;
    const vx = useDelta ? triki.ax - nx : triki.ax;
    const vy = useDelta ? triki.ay - ny : triki.ay;
    const len = Math.hypot(vx, vy);

    // tło
    diagCc.beginPath(); diagCc.arc(D_CX, D_CY, D_R, 0, Math.PI*2);
    diagCc.strokeStyle = 'rgba(255,255,255,0.15)'; diagCc.lineWidth = 1.5; diagCc.stroke();
    diagCc.fillStyle = 'rgba(255,255,255,0.03)'; diagCc.fill();
    // krzyż
    diagCc.strokeStyle = 'rgba(255,255,255,0.1)'; diagCc.lineWidth = 1;
    diagCc.beginPath(); diagCc.moveTo(D_CX-D_R, D_CY); diagCc.lineTo(D_CX+D_R, D_CY); diagCc.stroke();
    diagCc.beginPath(); diagCc.moveTo(D_CX, D_CY-D_R); diagCc.lineTo(D_CX, D_CY+D_R); diagCc.stroke();
    // okrąg docelowy (tylko kroki przechyłu)
    if (TILT_STEPS.has(stepId) && stepId !== 'neutral') {
      const rd = D_GOOD * D_SCALE;
      const good = len >= D_GOOD;
      diagCc.beginPath(); diagCc.arc(D_CX, D_CY, rd, 0, Math.PI*2);
      diagCc.strokeStyle = good ? 'rgba(34,197,94,0.55)' : 'rgba(239,68,68,0.55)';
      diagCc.lineWidth = 1.5; diagCc.setLineDash([3,3]); diagCc.stroke(); diagCc.setLineDash([]);
    }
    // pozycja kropki
    const rawX = D_CX + vx * D_SCALE, rawY = D_CY + vy * D_SCALE;
    const d = Math.hypot(rawX-D_CX, rawY-D_CY), rim = D_R - 6;
    const px = d > rim ? D_CX + (rawX-D_CX)/d*rim : rawX;
    const py = d > rim ? D_CY + (rawY-D_CY)/d*rim : rawY;
    const col = stepId === 'neutral' ? '#3b82f6'
              : !TILT_STEPS.has(stepId) ? '#a855f7'
              : len >= D_GOOD ? '#22c55e' : len >= 0.05 ? '#f59e0b' : '#ef4444';
    const grd = diagCc.createRadialGradient(px, py, 0, px, py, 10);
    grd.addColorStop(0, col); grd.addColorStop(1, col+'00');
    diagCc.beginPath(); diagCc.arc(px, py, 10, 0, Math.PI*2);
    diagCc.fillStyle = grd; diagCc.fill();
    diagCc.beginPath(); diagCc.arc(px, py, 5, 0, Math.PI*2);
    diagCc.fillStyle = col; diagCc.fill();

    // tekst pod canvasem
    if (TILT_STEPS.has(stepId) && stepId !== 'neutral') {
      const pct = Math.min(100, (len / D_GOOD) * 100);
      diagTval.textContent = `${pct.toFixed(0)}%`;
    } else {
      diagTval.textContent = `${len.toFixed(3)}g`;
    }
  }

  // Build live sensor bars
  barsEl.innerHTML = AXES6.map(k => {
    const isG = k[0]==='g';
    return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
      <span style="color:${AXES_COL[k]};font-size:9px;font-weight:700;width:20px;font-family:monospace">${k}</span>
      <div style="flex:1;height:7px;background:rgba(255,255,255,.05);border-radius:4px;overflow:hidden;position:relative">
        <div style="position:absolute;top:0;bottom:0;left:50%;width:1px;background:rgba(255,255,255,.12)"></div>
        <div id="_b_${k}" style="position:absolute;top:0;height:100%;background:${AXES_COL[k]};border-radius:4px;opacity:.85"></div>
      </div>
      <span id="_v_${k}" style="color:rgba(255,255,255,.65);font-size:9px;width:55px;text-align:right;font-family:monospace;white-space:nowrap"></span>
    </div>`;
  }).join('');

  // Live RAF
  let liveRaf;
  let _diagCurrentStep = 'neutral';
  (function live() {
    AXES6.forEach(k => {
      const val = triki[k];
      const scale = k[0]==='g' ? 200 : 1.2;
      const frac  = Math.min(1, Math.abs(val)/scale) * 50;
      const bar   = ov.querySelector(`#_b_${k}`);
      const valEl = ov.querySelector(`#_v_${k}`);
      if (bar) { bar.style.left = val>=0 ? '50%' : `${50-frac}%`; bar.style.width = frac+'%'; }
      if (valEl) valEl.textContent = (val>=0?'+':'')+val.toFixed(3);
    });
    drawDiagTilt(_diagCurrentStep);
    liveRaf = requestAnimationFrame(live);
  })();

  // ── helpers ───────────────────────────────────────────
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let cancelled = false;
  btnCancel.onclick = () => { cancelled = true; };

  function waitBtn() {
    return new Promise((res, rej) => {
      (function tick() {
        if (cancelled) { rej(new Error('cancelled')); return; }
        if (triki.consumeClick()) { res(); return; }
        requestAnimationFrame(tick);
      })();
    });
  }

  function recordFor(ms) {
    return new Promise(res => {
      const s = [], t0 = Date.now();
      progEl.style.transition = 'none'; progEl.style.width = '0%';
      const iv = setInterval(() => {
        s.push({ t: Date.now()-t0, ax:triki.ax, ay:triki.ay, az:triki.az, gx:triki.gx, gy:triki.gy, gz:triki.gz });
        const pct = Math.min(100, (Date.now()-t0)/ms*100);
        progEl.style.transition = 'none'; progEl.style.width = pct+'%';
        if (Date.now()-t0 >= ms) { clearInterval(iv); progEl.style.width='100%'; res(s); }
      }, 25);
    });
  }

  function analyze(samples, neutral) {
    const n = samples.length || 1;
    const sum = {}, sum2 = {}, mn = {}, sd = {}, pk = {}, pkDelta = {};
    AXES6.forEach(k => { sum[k]=0; sum2[k]=0; pk[k]=0; });
    samples.forEach(s => AXES6.forEach(k => {
      sum[k]  += s[k];
      sum2[k] += s[k]*s[k];
      if (Math.abs(s[k]) > Math.abs(pk[k])) pk[k] = s[k];
    }));
    AXES6.forEach(k => {
      mn[k] = sum[k]/n;
      sd[k] = Math.sqrt(Math.max(0, sum2[k]/n - mn[k]*mn[k]));
      // peak delta od neutral (wyodrębnia chwilowe przyspieszenie liniowe)
      pkDelta[k] = neutral ? pk[k] - neutral.mean[k] : pk[k];
    });
    return { mean: mn, std: sd, peak: pk, peakDelta: pkDelta, n, raw_samples: samples };
  }

  // ── run intro ────────────────────────────────────────
  msgEl.textContent = `${STEPS.length} kroków — przy każdym wciśnij przycisk kapsla żeby zacząć pomiar`;
  subEl.textContent = 'Wyniki zostaną zapisane na serwerze (data/logs/) do analizy';
  warnEl.textContent = '';
  await sleep(1500);

  // ── run steps ────────────────────────────────────────
  try {
    for (let i = 0; i < STEPS.length && !cancelled; i++) {
      const step = STEPS[i];
      _diagCurrentStep = step.id;
      lblEl.textContent = `KROK ${i+1} / ${STEPS.length}  ·  ${step.label}`;
      icoEl.textContent = step.emoji;
      msgEl.textContent = step.msg;
      subEl.textContent = step.sub;
      ctrEl.textContent = `${i+1} / ${STEPS.length}`;
      progEl.style.width = '0%';

      if (step.btn) {
        warnEl.style.color = '#f59e0b';
        warnEl.textContent = '▶ Naciśnij przycisk na kapslu…';
        await waitBtn();
        stepResults.button = { detected: true };
        warnEl.style.color = '#22c55e';
        warnEl.textContent = '✓ Przycisk wykryty!';
        await sleep(700);
      } else {
        warnEl.style.color = '#f59e0b';
        warnEl.textContent = '▶ Ustaw pozycję → wciśnij przycisk kapsla → trzymaj przez 1.5 sek.';
        await waitBtn();
        warnEl.style.color = '#22c55e';
        warnEl.textContent = '🔴 NAGRYWAM…';
        await sleep(60);

        const samples = await recordFor(RECORD_MS);
        const neutral0 = stepResults.neutral || null;
        const result  = analyze(samples, neutral0);
        stepResults[step.id] = result;

        // quick per-step feedback
        warnEl.style.color = '#22c55e';
        if (step.id === 'neutral') {
          warnEl.textContent = `✓ baseline: ax${result.mean.ax>=0?'+':''}${result.mean.ax.toFixed(3)} ay${result.mean.ay>=0?'+':''}${result.mean.ay.toFixed(3)} az${result.mean.az>=0?'+':''}${result.mean.az.toFixed(3)}`;
        } else if (step.peak) {
          // dla translacji: patrzymy na peak delta, nie średnią
          const pd = result.peakDelta;
          const domP = ['ax','ay','az'].reduce((a,b)=>Math.abs(pd[a])>Math.abs(pd[b])?a:b);
          warnEl.textContent = `✓ peak dom: ${domP} ${pd[domP]>=0?'+':''}${pd[domP].toFixed(3)}g (σ=${result.std[domP].toFixed(3)})`;
        } else {
          const d = {};
          ['ax','ay','az'].forEach(k => d[k] = result.mean[k]-(neutral0?.mean[k]||0));
          const domA = ['ax','ay','az'].reduce((a,b)=>Math.abs(d[a])>Math.abs(d[b])?a:b);
          const domG = ['gx','gy','gz'].reduce((a,b)=>Math.abs(result.mean[a])>Math.abs(result.mean[b])?a:b);
          warnEl.textContent = `✓ accel dom: ${domA} Δ${d[domA]>=0?'+':''}${d[domA].toFixed(3)}g  |  gyro dom: ${domG} ${result.mean[domG]>=0?'+':''}${result.mean[domG].toFixed(1)}°/s`;
        }
        await sleep(1000);
      }
    }

    if (!cancelled) {
      // ── full analysis ─────────────────────────────────
      const neutral = stepResults.neutral;
      const ACCEL3 = ['ax','ay','az'], GYRO3 = ['gx','gy','gz'];

      function domA(id) {
        if (!stepResults[id] || !neutral) return '?';
        const d = {};
        ACCEL3.forEach(k => d[k] = stepResults[id].mean[k]-neutral.mean[k]);
        return ACCEL3.reduce((a,b)=>Math.abs(d[a])>Math.abs(d[b])?a:b);
      }
      function domG(id) {
        if (!stepResults[id]) return '?';
        const m = stepResults[id].mean;
        return GYRO3.reduce((a,b)=>Math.abs(m[a])>Math.abs(m[b])?a:b);
      }
      function delta(id, key) {
        if (!stepResults[id] || !neutral) return 0;
        return stepResults[id].mean[key] - neutral.mean[key];
      }

      // auto-detect translational axes (before analysis block)
      const _liftPd   = stepResults.lift?.peakDelta   || {};
      const _dropPd   = stepResults.drop?.peakDelta   || {};
      const _slideRPd = stepResults.slide_r?.peakDelta|| {};
      const _slideFPd = stepResults.slide_fwd?.peakDelta||{};
      const _domPd    = pd => ACCEL3.reduce((a,b)=>Math.abs(pd[a]||0)>Math.abs(pd[b]||0)?a:b);

      const rightAxis  = domA('right');
      const fwdAxis    = domA('fwd');
      const rotAxis    = domG('rot_cw');
      const liftAxisA  = _domPd(_liftPd);
      const slideAxisA = _domPd(_slideRPd);
      const analysis = {
        right:     { axis: rightAxis,  delta: delta('right', rightAxis).toFixed(4), sign: delta('right',rightAxis)>=0?'+':'-' },
        left:      { axis: domA('left'), delta: delta('left', domA('left')).toFixed(4) },
        fwd:       { axis: fwdAxis,    delta: delta('fwd',  fwdAxis).toFixed(4),   sign: delta('fwd', fwdAxis)>=0?'+':'-' },
        back:      { axis: domA('back'), delta: delta('back', domA('back')).toFixed(4) },
        rot_cw:    { axis: rotAxis,    mean: stepResults.rot_cw?.mean[rotAxis]?.toFixed(2) },
        rot_ccw:   { axis: domG('rot_ccw'), mean: stepResults.rot_ccw?.mean[domG('rot_ccw')]?.toFixed(2) },
        lift:      { axis: liftAxisA,  peak: (_liftPd[liftAxisA]||0).toFixed(3),   std: (stepResults.lift?.std?.[liftAxisA]||0).toFixed(3) },
        drop:      { axis: _domPd(_dropPd),   peak: (_dropPd[_domPd(_dropPd)]||0).toFixed(3) },
        slide_r:   { axis: slideAxisA, peak: (_slideRPd[slideAxisA]||0).toFixed(3) },
        slide_fwd: { axis: _domPd(_slideFPd), peak: (_slideFPd[_domPd(_slideFPd)]||0).toFixed(3) },
      };

      // ── results table ─────────────────────────────────
      const PEAK_IDS = new Set(['lift','drop','slide_r','slide_fwd']);
      function fmt(v, d=3) { if (v==null||isNaN(v)) return '—'; return (v>=0?'+':'')+Number(v).toFixed(d); }

      // Wiersz dla kroków statycznych (tilt, rotation) — pokazuje średnią
      function rowMean(id, emoji, label) {
        const r = stepResults[id]; if (!r || r.detected) return '';
        const m = r.mean;
        const d = {};
        ACCEL3.forEach(k => d[k] = neutral ? m[k]-neutral.mean[k] : 0);
        const dA = ACCEL3.reduce((a,b)=>Math.abs(d[a])>Math.abs(d[b])?a:b);
        const dG = GYRO3.reduce((a,b)=>Math.abs(m[a])>Math.abs(m[b])?a:b);
        const hiA = `<span style="background:rgba(255,255,255,.12);padding:1px 3px;border-radius:3px">${dA}${fmt(d[dA])}</span>`;
        const hiG = `<span style="color:#06b6d4">${dG}${fmt(m[dG],1)}°</span>`;
        return `<tr style="border-bottom:1px solid rgba(255,255,255,.05)">
          <td style="padding:3px 5px;color:rgba(255,255,255,.55);font-size:9px;white-space:nowrap">${emoji} ${label}</td>
          ${ACCEL3.map(k=>`<td style="padding:3px 3px;color:${AXES_COL[k]};font-size:9px;font-family:monospace">${fmt(m[k])}</td>`).join('')}
          ${GYRO3.map(k=>`<td style="padding:3px 3px;color:${AXES_COL[k]};font-size:9px;font-family:monospace">${fmt(m[k],1)}</td>`).join('')}
          <td style="padding:3px 5px;font-size:9px;white-space:nowrap">${id==='neutral'?'—':hiA+' '+hiG}</td>
        </tr>`;
      }

      // Wiersz dla kroków translacyjnych — pokazuje peak delta od neutral
      function rowPeak(id, emoji, label) {
        const r = stepResults[id]; if (!r) return '';
        const pd = r.peakDelta;
        if (!pd) return rowMean(id, emoji, label);
        const domP = ACCEL3.reduce((a,b)=>Math.abs(pd[a])>Math.abs(pd[b])?a:b);
        const hiP = `<span style="background:rgba(255,255,100,.15);color:#fef08a;padding:1px 3px;border-radius:3px">↑peak ${domP}${fmt(pd[domP])}</span>`;
        return `<tr style="border-bottom:1px solid rgba(255,255,255,.05)">
          <td style="padding:3px 5px;color:rgba(255,255,200,.7);font-size:9px;white-space:nowrap">${emoji} ${label} <span style="font-size:8px;opacity:.5">peak</span></td>
          ${ACCEL3.map(k=>`<td style="padding:3px 3px;color:${AXES_COL[k]};font-size:9px;font-family:monospace">${fmt(pd[k])}</td>`).join('')}
          ${GYRO3.map(k=>`<td style="padding:3px 3px;color:${AXES_COL[k]};font-size:9px;font-family:monospace;opacity:.45">${fmt(r.mean[k],1)}</td>`).join('')}
          <td style="padding:3px 5px;font-size:9px;white-space:nowrap">${hiP}</td>
        </tr>`;
      }

      // liftAxisA / slideAxisA already computed above in analysis block

      resEl.innerHTML = `
        <div style="color:rgba(255,255,255,.28);font-size:8px;letter-spacing:1.5px;margin-bottom:5px">
          WYNIKI (accel=g śr. lub Δpeak, gyro=°/s śr.)
        </div>
        <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
        <table style="width:100%;border-collapse:collapse;font-family:monospace;white-space:nowrap">
          <thead><tr style="border-bottom:1px solid rgba(255,255,255,.1)">
            <th style="text-align:left;padding:3px 5px;color:rgba(255,255,255,.25);font-size:8px;font-weight:400">KROK</th>
            ${ACCEL3.map(k=>`<th style="padding:2px 3px;color:${AXES_COL[k]};font-size:8px">${k}</th>`).join('')}
            ${GYRO3.map(k=>`<th style="padding:2px 3px;color:${AXES_COL[k]};font-size:8px">${k}</th>`).join('')}
            <th style="padding:2px 5px;color:rgba(255,255,255,.25);font-size:8px;font-weight:400">dominuje</th>
          </tr></thead>
          <tbody>
            ${rowMean('neutral','🤚','Neutral')}
            ${rowMean('right','➡️','Prawo')}
            ${rowMean('left','⬅️','Lewo')}
            ${rowMean('fwd','⬆️','Przód')}
            ${rowMean('back','⬇️','Tył')}
            ${rowMean('rot_cw','🔃','Obrót CW')}
            ${rowMean('rot_ccw','🔄','Obrót CCW')}
            <tr><td colspan="8" style="padding:3px 5px;color:rgba(255,200,100,.4);font-size:8px;border-top:1px solid rgba(255,200,100,.15)">— LINIOWE (translacja) —</td></tr>
            ${rowPeak('lift','🔼','Podnieś')}
            ${rowPeak('drop','🔽','Opuść')}
            ${rowPeak('slide_r','↔️','Przesuń →')}
            ${rowPeak('slide_fwd','⬆↔','Przesuń ↑')}
          </tbody>
        </table>
        </div>
        ${stepResults.button?.detected ? '<div style="color:#22c55e;font-size:10px;margin-top:6px">🔘 Przycisk ✓</div>' : ''}
        <div style="color:rgba(255,255,255,.22);font-size:9px;margin-top:8px;line-height:1.7">
          Oś L/R: <b style="color:#fff">${analysis.right.axis}</b> (prawo=${analysis.right.sign}${Math.abs(delta('right',rightAxis)).toFixed(3)}g) &nbsp;·&nbsp;
          Oś F/B: <b style="color:#fff">${analysis.fwd.axis}</b> (przód=${analysis.fwd.sign}${Math.abs(delta('fwd',fwdAxis)).toFixed(3)}g)<br>
          Obrót: <b style="color:#fff">${analysis.rot_cw.axis}</b> (CW=${analysis.rot_cw.mean}°/s) &nbsp;·&nbsp;
          Podnieś: <b style="color:#fef08a">${analysis.lift.axis}</b> (peak=${analysis.lift.peak}g σ=${analysis.lift.std}g) &nbsp;·&nbsp;
          Przesuń→: <b style="color:#fef08a">${analysis.slide_r.axis}</b> (peak=${analysis.slide_r.peak}g)
        </div>`;

      // ── switch to results view ─────────────────────────
      liveEl.style.display = 'none';
      resEl.style.display  = 'block';
      lblEl.textContent    = 'DIAGNOSTYKA ZAKOŃCZONA';
      icoEl.textContent    = '📊';
      msgEl.textContent    = 'Wyniki';
      subEl.textContent    = 'Zapisuję na serwer…';
      warnEl.textContent   = '';
      progEl.style.width   = '100%';
      ctrEl.textContent    = '';
      btnDone.style.display = 'block';
      btnCancel.textContent = 'Zamknij';

      // ── save to server ────────────────────────────────
      const payload = {
        device   : triki.name || 'Triki',
        timestamp: new Date().toISOString(),
        steps    : Object.fromEntries(Object.entries(stepResults).map(([id, r]) =>
          [id, r.detected ? r : { mean: r.mean, std: r.std, peak: r.peak, peakDelta: r.peakDelta, n: r.n }]
        )),
        analysis,
        raw_per_step: Object.fromEntries(Object.entries(stepResults).map(([id, r]) =>
          [id, r.raw_samples || []]
        )),
      };
      try {
        const res = await fetch('/api/diag', {
          method : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body   : JSON.stringify(payload),
        });
        const j = await res.json();
        subEl.textContent = `Zapisano: ${j.file || 'data/logs/'}`;
      } catch(e) {
        subEl.textContent = 'Błąd zapisu na serwer (offline?)';
      }

      await new Promise(res => { btnDone.onclick = res; btnCancel.onclick = res; });
    }

  } catch(e) {
    if (e.message !== 'cancelled') console.error('[diag]', e);
  } finally {
    cancelAnimationFrame(liveRaf);
    ov.remove();
  }
}

// ════════════════════════════════════════════════════════
// BLE UI
// ════════════════════════════════════════════════════════
triki.onStatus = () => {
  updateBlePanel();
  updateGameBleCh();
  // When first connected and no profile for this device → open nick modal
  if (triki.connected && (!player || player.deviceId !== triki.deviceId)) {
    openNickModal(triki.name, triki.deviceId);
  } else if (triki.connected && player && !player.trikiName) {
    player.trikiName = triki.name;
    savePlayer(player);
  }
};

function updateBlePanel() {
  blePanel.className = 'ble-panel ' + (triki.connected ? 'connected' : triki.connecting ? 'connecting' : 'disconnected');
  if (triki.connected) {
    bleLabel.textContent = triki.name || 'Kapsel Żabki';
    bleSub.textContent   = 'Podłączony — graj żyroskopem';
    btnBle.textContent   = '🔌 Rozłącz';
    btnBle.className     = 'btn-ble disconnect';
    $('ble-gyro-bars').style.display = 'flex';
    $('ble-sens-row').style.display = 'flex';
    _renderCalibBtn();
  } else if (triki.connecting) {
    bleLabel.textContent = 'Łączenie…';
    bleSub.textContent   = 'Szukam kapsla BLE…';
    btnBle.textContent   = '⏳ Czekaj…';
    btnBle.className     = 'btn-ble search disabled';
    $('ble-gyro-bars').style.display = 'none';
    $('ble-sens-row').style.display = 'none';
  } else {
    const op = document.getElementById('calib-btn-wrap');
    if (op) op.remove();
    bleLabel.textContent = 'Kontroler BLE';
    bleSub.textContent   = triki.supported
      ? 'Wyszukaj kapsla Żabki żeby grać żyroskopem'
      : 'Web Bluetooth niedostępny w tej przeglądarce';
    btnBle.textContent   = '🔌 Szukaj';
    btnBle.className     = 'btn-ble search' + (triki.supported ? '' : ' disabled');
    $('ble-gyro-bars').style.display = 'none';
    $('ble-sens-row').style.display = 'none';
  }
}

function bleAction() {
  if (!triki.supported) {
    const secure = window.isSecureContext;
    const proto  = location.protocol;
    const host   = location.hostname;
    showToast(
      `Web Bluetooth niedostępny.\n` +
      `Przeglądarka: ${navigator.userAgent.includes('Chrome') ? 'Chrome ✓' : 'nie-Chrome ✗'}\n` +
      `Kontekst: ${proto}//${host} ${secure ? '🔒 bezpieczny' : '⚠️ NIEZABEZPIECZONY – potrzebny localhost lub https'}`
    );
    return;
  }
  triki.connected ? triki.disconnect() : triki.connect().catch(e => {
    showToast('BLE błąd: ' + e.name + '\n' + e.message);
  });
}

function showToast(msg) {
  let t = document.getElementById('ble-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'ble-toast';
    t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1e293b;color:#fff;padding:12px 18px;border-radius:12px;font-size:13px;max-width:90vw;white-space:pre-wrap;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.1)';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._tid);
  t._tid = setTimeout(() => { t.style.opacity = '0'; }, 6000);
}

function updateGameBleCh() {
  if (triki.connected) {
    bleCh.classList.remove('hidden');
    bleChName.textContent = triki.name || 'Kapsel';
  } else {
    bleCh.classList.add('hidden');
  }
}

// animated gyro bars in hub
function animateGyroBars() {
  if (triki.connected && hub.style.display !== 'none') {
    const toW = v => Math.min(100, Math.abs(v) * 3) + '%';
    gyroXFill.style.width = toW(triki.gx);
    gyroZFill.style.width = toW(triki.gz);
  }
  requestAnimationFrame(animateGyroBars);
}
requestAnimationFrame(animateGyroBars);

// ════════════════════════════════════════════════════════
// HUB — game cards
// ════════════════════════════════════════════════════════
async function loadGames() {
  try {
    const r = await fetch('/api/games');
    games = await r.json();
    renderCards();
  } catch(e) {
    gameCards.innerHTML = '<p style="text-align:center;opacity:.5">Błąd ładowania gier</p>';
  }
  return games;
}

const TABS = [
  { tag: '',          label: '✦ Wszystkie' },
  { tag: '__games',   label: '🎮 Gry'      },
  { tag: '__apps',    label: '📱 Apki'     },
  { tag: 'arcade',    label: '🕹 Arcade'   },
  { tag: 'skill',     label: '🎯 Zręczność'},
  { tag: 'puzzle',    label: '🧩 Puzzle'   },
];

function renderTabBar() {
  const bar = $('tab-bar');
  if (!bar) return;
  bar.innerHTML = '';
  TABS.forEach(({tag, label}) => {
    const btn = document.createElement('button');
    btn.className = 'tab' + (tag === _activeTag ? ' active' : '');
    btn.textContent = label;
    btn.onclick = () => { _activeTag = tag; renderTabBar(); renderCards(); };
    bar.appendChild(btn);
  });
}

function renderCards() {
  let filtered;
  if (_activeTag === '__games') {
    filtered = games.filter(g => g.type !== 'app');
  } else if (_activeTag === '__apps') {
    filtered = games.filter(g => g.type === 'app');
  } else if (_activeTag) {
    filtered = games.filter(g => g.tag === _activeTag);
  } else {
    filtered = games;
  }
  if (!filtered.length) {
    gameCards.innerHTML = '<p style="text-align:center;opacity:.4;padding:24px 0">Brak gier w tej kategorii</p>';
    return;
  }
  gameCards.innerHTML = '';
  filtered.forEach((g, i) => {
    const hs = g.hasScore ? getLocalHS(g.id) : null;
    const card = document.createElement('div');
    card.className = `game-card ${g.color || 'green'}`;
    card.style.animationDelay = `${i * 55}ms`;
    const isApp = g.type === 'app';
    card.innerHTML = `
      <div class="card-corners"></div>
      <div class="card-icon">${g.emoji || '🎮'}</div>
      <div class="card-body">
        <div class="card-title-row">
          <div class="card-title">${esc(g.title)}</div>
          <span class="diff">${esc(g.difficulty || '')}</span>
        </div>
        <div class="card-desc">${esc(g.description || '')}</div>
        ${hs !== null ? `<div class="card-hs">🏆 Rekord: <b>${hs}</b> ${esc(g.scoreUnit || 'pkt')}</div>` : ''}
        <button class="play-btn">${isApp ? '▶ OTWÓRZ' : '▶ GRAJ'}</button>
      </div>`;
    card.addEventListener('click', () => openGame(g));
    gameCards.appendChild(card);
  });
}

// ════════════════════════════════════════════════════════
// GAME RUNNER
// ════════════════════════════════════════════════════════
async function openGame(meta) {
  // dynamic import
  let mod;
  try {
    mod = await import(`/games/${meta.id}/game.js`);
  } catch(e) {
    console.error('[openGame] import error', e);
    return;
  }
  const GameClass = mod.default;

  // show game view
  hub.style.display      = 'none';
  gameView.style.display = 'flex';
  titleText.textContent  = meta.title;
  updateGameBleCh();
  statsArea.innerHTML    = '';

  // resize canvas
  resizeCanvas();

  // set steering scheme before starting the game
  triki.scheme = meta.scheme || 'tilt';

  // create game instance
  const inst = new GameClass(canvas, ctx, triki, emit);
  current = { meta, inst };

  // push history state to handle physical back button on Android
  history.pushState({ inGame: true }, '');

  // start overlay
  showStartOverlay(meta);
}

function emit(evt, data) {
  if (!current) return;
  if (evt === 'stats') {
    statsArea.innerHTML = data;
  } else if (evt === 'end') {
    stopLoop();
    handleEnd(data);
  }
}

function showStartOverlay(meta) {
  ovEnd.classList.add('hidden');
  ovStart.classList.remove('hidden');

  $('ov-start-emoji').textContent  = meta.emoji || '🎮';
  $('ov-start-title').textContent  = meta.title;
  $('ov-start-sub').textContent    = meta.description || '';

  const ctrl = meta.controls;
  if (ctrl) {
    // podświetl aktywny sposób sterowania (BLE gdy kapsel podłączony)
    $('ov-start-controls').innerHTML =
      (ctrl.ble   ? `<div class="${triki.connected ? 'ctrl-ble' : 'ctrl-mouse'}">🎮 ${esc(ctrl.ble)}</div>` : '') +
      (ctrl.mouse ? `<div class="${triki.connected ? 'ctrl-mouse' : 'ctrl-ble'}">🖱️ ${esc(ctrl.mouse)}</div>` : '') +
      (ctrl.keys  ? `<div class="ctrl-mouse">⌨️ ${esc(ctrl.keys)}</div>` : '');
  }

  // wybór trybu sterowania kapslem (np. Arkanoid: obrót vs przechył)
  const modesEl = $('ov-start-modes');
  modesEl.innerHTML = '';
  if (meta.ctrlModes?.length && triki.connected) {
    const lsKey = `ctrlmode_${meta.id}`;
    let sel = localStorage.getItem(lsKey) || meta.ctrlModes[0].id;
    if (!meta.ctrlModes.some(m => m.id === sel)) sel = meta.ctrlModes[0].id;
    meta.ctrlModes.forEach(m => {
      const b = document.createElement('button');
      b.className = 'mode-btn' + (m.id === sel ? ' selected' : '');
      b.textContent = m.label;
      b.onclick = () => {
        localStorage.setItem(lsKey, m.id);
        triki.scheme = m.scheme || meta.scheme || 'tilt';
        modesEl.querySelectorAll('.mode-btn').forEach(x => x.classList.remove('selected'));
        b.classList.add('selected');
      };
      modesEl.appendChild(b);
    });
    // zastosuj zapamiętany wybór od razu
    const m0 = meta.ctrlModes.find(m => m.id === sel);
    triki.scheme = m0?.scheme || meta.scheme || 'tilt';
  }

  // personal best
  const hs = getLocalHS(current.meta.id);
  $('ov-start-hs').innerHTML = (hs !== null && meta.hasScore)
    ? `<span class="ov-hs-label">Twój rekord: <b>${hs} ${meta.scoreUnit||'pkt'}</b></span>`
    : '';

  btnStart.onclick = async () => {
    if (triki.connected && !current?.meta?.skipCalib) {
      await startCalib();
    }
    ovStart.classList.add('hidden');
    startGame();
  };
}

function startGame() {
  if (!current) return;
  current.inst.start(player);
  startLoop();
}

function startLoop() {
  stopLoop();
  lastT = performance.now();
  function loop(t) {
    const dt = Math.min(t - lastT, 100); // cap at 100ms
    lastT = t;
    logFrame();
    current?.inst?.update?.(dt);
    current?.inst?.draw?.(dt);
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);
}

function stopLoop() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

async function handleEnd(data) {
  ovEnd.classList.remove('hidden');
  $('ov-end-emoji').textContent = current.meta.emoji || '🎮';

  if (data.score !== undefined) {
    // score-based game (catch, frog, crawler, arkanoid)
    $('ov-end-title').textContent =
      data.won === true  ? 'Wygrałeś! 🎉' :
      data.won === false ? 'Koniec gry 💀' : 'Koniec gry!';
    animateCount($('ov-end-score'), data.score, current.meta.scoreUnit || 'pkt');

    const prevHS = getLocalHS(current.meta.id);
    if (prevHS === null || data.score > prevHS) {
      setLocalHS(current.meta.id, data.score);
      $('ov-end-newrec').classList.remove('hidden');
    } else {
      $('ov-end-newrec').classList.add('hidden');
    }

    // save to server
    if (player && data.score > 0) {
      await submitScore(current.meta.id, data.score);
    }
    // render leaderboard
    await renderLeaderboard(current.meta.id, data.score);

  } else if (data.won !== undefined) {
    // pong-style
    $('ov-end-title').textContent  = data.won ? 'Wygrałeś! 🎉' : 'Przegrałeś 😔';
    $('ov-end-score').textContent  = `${data.playerScore ?? 0} : ${data.aiScore ?? 0}`;
    $('ov-end-newrec').classList.add('hidden');
    $('ov-leaderboard').innerHTML  = '';
  }

  btnRestart.onclick = () => { ovEnd.classList.add('hidden'); showStartOverlay(current.meta); };
  btnMenu.onclick    = () => goHub(true);
}

async function submitScore(gameId, score) {
  try {
    await fetch(`/api/scores/${gameId}`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        score,
        nick     : player.nick,
        color    : player.color,
        device_id: player.deviceId,
      }),
    });
  } catch(_) {}
}

async function renderLeaderboard(gameId, myScore) {
  const el = $('ov-leaderboard');
  el.innerHTML = '<p style="opacity:.4;font-size:.8rem">Ładowanie tabeli…</p>';
  try {
    const scores = await fetch(`/api/scores/${gameId}`).then(r => r.json());
    if (!scores.length) { el.innerHTML = ''; return; }
    const top = scores.slice(0, 10);
    const myPos = player ? scores.findIndex(s => s.device_id === player.deviceId) : -1;

    let html = '<div class="leaderboard"><div class="lb-title">🏆 Najlepsi gracze</div>';
    top.forEach((s, i) => {
      const isMe = player && s.device_id === player.deviceId && s.score === myScore;
      html += `<div class="lb-row${isMe ? ' lb-me' : ''}">
        <span class="lb-rank">#${i+1}</span>
        <span class="lb-dot" style="background:${s.color||'#888'}"></span>
        <span class="lb-nick">${esc(s.nick||'Gość')}</span>
        <span class="lb-score">${s.score}</span>
      </div>`;
    });
    // show player position if outside top 10
    if (myPos >= 10) {
      const s = scores[myPos];
      html += `<div class="lb-row lb-me lb-gap">
        <span class="lb-rank">#${myPos+1}</span>
        <span class="lb-dot" style="background:${s.color||'#888'}"></span>
        <span class="lb-nick">${esc(s.nick||'Gość')}</span>
        <span class="lb-score">${s.score}</span>
      </div>`;
    }
    html += '</div>';
    el.innerHTML = html;
  } catch(_) {
    el.innerHTML = '';
  }
}

// ── local high-score ──────────────────────────────────────
function getLocalHS(gid) {
  try { return JSON.parse(localStorage.getItem('hs_'+gid)); } catch(_) { return null; }
}
function setLocalHS(gid, v) {
  localStorage.setItem('hs_'+gid, JSON.stringify(v));
}

// ── navigation ────────────────────────────────────────────
function goHub(shouldGoBack = true) {
  stopLoop();
  if (current?.inst?.destroy) current.inst.destroy();
  current = null;
  ovStart.classList.remove('hidden');
  ovEnd.classList.add('hidden');
  gameView.style.display = 'none';
  hub.style.display      = '';
  statsArea.innerHTML    = '';
  renderPlayerPanel();
  renderTabBar();
  renderCards(); // odśwież lokalne rekordy na kartach

  if (shouldGoBack && history.state?.inGame) {
    history.back();
  }
}

btnBack.onclick = () => goHub(true);

// Listen for browser/phone Back button (popstate)
window.addEventListener('popstate', (e) => {
  if (gameView.style.display !== 'none') {
    // If the game view was active, go back to Hub (passing false so we don't trigger history.back() again)
    goHub(false);
  }
});

// ── canvas resize ─────────────────────────────────────────
function resizeCanvas() {
  const cc = $('canvas-container');
  const W  = cc.clientWidth;
  const H  = cc.clientHeight;
  canvas.width  = W;
  canvas.height = H;
  current?.inst?.resize?.(W, H);
}

window.addEventListener('resize', () => {
  if (gameView.style.display !== 'none') resizeCanvas();
});

// ── input forwarding ──────────────────────────────────────
canvas.addEventListener('mousemove', e => {
  if (!current?.inst || triki.connected) return;
  const r = canvas.getBoundingClientRect();
  current.inst.onMouseMove?.((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
});

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (!current?.inst || triki.connected) return;
  const r  = canvas.getBoundingClientRect();
  const t  = e.touches[0];
  current.inst.onMouseMove?.((t.clientX - r.left) / r.width, (t.clientY - r.top) / r.height);
}, {passive: false});

canvas.addEventListener('click', e => {
  if (!current?.inst) return;
  const r = canvas.getBoundingClientRect();
  current.inst.onClick?.((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
});

canvas.addEventListener('touchend', e => {
  e.preventDefault();
  if (!current?.inst) return;
  const r = canvas.getBoundingClientRect();
  const t = e.changedTouches[0];
  current.inst.onClick?.((t.clientX - r.left) / r.width, (t.clientY - r.top) / r.height);
}, {passive: false});

document.addEventListener('keydown', e => {
  current?.inst?.onKeyDown?.(e.code);
});

document.addEventListener('keyup', e => {
  current?.inst?.onKeyUp?.(e.code);
});

// ── utils ─────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── ripple effect ─────────────────────────────────────────
function _spawnRipple(btn, clientX, clientY) {
  const r = btn.getBoundingClientRect();
  const wave = document.createElement('span');
  wave.className = 'ripple-wave' + (btn.classList.contains('green') || btn.classList.contains('search') ? ' dark' : '');
  wave.style.left = (clientX - r.left) + 'px';
  wave.style.top  = (clientY - r.top)  + 'px';
  btn.appendChild(wave);
  wave.addEventListener('animationend', () => wave.remove(), {once: true});
}

document.addEventListener('pointerdown', e => {
  const btn = e.target.closest(
    '.btn-primary, .btn-outline, .play-btn, .btn-ble, .mode-btn'
  );
  if (!btn) return;
  _spawnRipple(btn, e.clientX, e.clientY);
  navigator.vibrate?.(8);
});

// ── score count-up animation ──────────────────────────────
function animateCount(el, target, suffix) {
  if (!target || target <= 0) { el.textContent = `0 ${suffix}`; return; }
  const duration = Math.min(900, 20 * Math.sqrt(target) + 200);
  const t0 = performance.now();
  (function tick(now) {
    const p = Math.min(1, (now - t0) / duration);
    const ease = 1 - Math.pow(1 - p, 3);
    el.textContent = `${Math.round(ease * target)} ${suffix}`;
    if (p < 1) requestAnimationFrame(tick);
  })(t0);
}

// ════════════════════════════════════════════════════════
// LOGGING
// ════════════════════════════════════════════════════════
let _logSamples  = [];
let _logActive   = false;
let _logFrame    = 0;
let _logInterval = null;

function _logTick() {
  if (!_logActive || !triki.connected) return;
  _logSamples.push({
    timestamp : Date.now(),
    frameIndex: _logFrame++,
    gx: +triki.gx.toFixed(4), gy: +triki.gy.toFixed(4), gz: +triki.gz.toFixed(4),
    ax: +triki.ax.toFixed(4), ay: +triki.ay.toFixed(4), az: +triki.az.toFixed(4),
  });
}

function logFrame() {} // kept for game loop call — actual logging via interval

function renderLogBtn() {
  const b = document.getElementById('btn-log');
  if (!b) return;
  if (!triki.connected) { b.style.display = 'none'; return; }
  b.style.display = '';
  if (_logActive) {
    b.textContent = `⏹ Zatrzymaj (${_logSamples.length})`;
    b.style.background = '#ef4444';
  } else {
    b.textContent = '⏺ Nagraj logi';
    b.style.background = '#6366f1';
  }
}

async function toggleLog() {
  if (!_logActive) {
    _logSamples = []; _logFrame = 0; _logActive = true;
    _logInterval = setInterval(_logTick, 50); // 20 Hz
    showToast('Nagrywanie…');
  } else {
    clearInterval(_logInterval); _logInterval = null;
    _logActive = false;
    if (!_logSamples.length) { showToast('Brak danych'); renderLogBtn(); return; }
    showToast(`Zapisuję ${_logSamples.length} próbek…`);
    try {
      const r = await fetch('/api/log', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({samples: _logSamples, device: triki.name}),
      });
      const j = await r.json();
      showToast(`✅ Zapisano: ${j.file || 'plik'}`);
    } catch(e) {
      showToast('❌ Błąd zapisu: ' + e.message);
    }
  }
  renderLogBtn();
}

// inject log button into BLE panel after connect
function injectLogBtn() {
  if (document.getElementById('btn-log')) return;
  const b = document.createElement('button');
  b.id = 'btn-log';
  b.style.cssText = 'display:none;margin-top:8px;width:100%;padding:8px 14px;border:none;border-radius:10px;color:#fff;font-weight:600;font-size:13px;cursor:pointer';
  b.addEventListener('click', toggleLog);
  blePanel.appendChild(b);
}

// ── wire BLE button directly (user gesture must reach requestDevice) ──
btnBle.addEventListener('click', bleAction);

// inject log btn and update on status change
const _origOnStatus = triki.onStatus;
triki.onStatus = () => {
  _origOnStatus && _origOnStatus();
  injectLogBtn();
  renderLogBtn();
  if (!triki.connected && _logActive) {
    _logActive = false;
    clearInterval(_logInterval); _logInterval = null;
    renderLogBtn();
  }
};

// ── expose to HTML onclick attrs ──────────────────────────
window._app = { bleAction, editProfile };

// ── init ──────────────────────────────────────────────────
loadPlayer();
renderPlayerPanel();
updateBlePanel();
loadGames().then(() => renderTabBar());
_requestWakeLock();

// Czułość slider init
const sensSlider = $('sens-slider');
const sensVal = $('sens-val');
if (sensSlider && sensVal) {
  const currentSens = Math.round(triki.sensitivity * 100);
  sensSlider.value = currentSens;
  sensVal.textContent = currentSens + '%';

  sensSlider.addEventListener('input', () => {
    const v = parseInt(sensSlider.value);
    sensVal.textContent = v + '%';
    triki.sensitivity = v / 100;
    localStorage.setItem('triki_sensitivity', triki.sensitivity.toString());
  });
}

// auto-reconnect to last known device
triki.autoConnect().catch(() => {});
