<?php
// diag.php — Triki Game Controller Diagnostic Tool
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
header('Expires: 0');
?>
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>🐸 Triki Diagnostyka</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🐸</text></svg>">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-dark: #0a0d16;
      --card-bg: #121826;
      --card-border: rgba(255, 255, 255, 0.08);
      --green: #22c55e;
      --green-glow: rgba(34, 197, 94, 0.25);
      --blue: #3b82f6;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: var(--bg-dark);
      color: var(--text-main);
      font-family: 'Outfit', sans-serif;
      padding: 20px;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .container {
      width: 100%;
      max-width: 600px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    header {
      text-align: center;
      margin-bottom: 10px;
    }

    header h1 {
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: var(--green);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
    }

    header p {
      font-size: 14px;
      color: var(--text-muted);
      margin-top: 5px;
    }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 20px;
      box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3);
    }

    .btn {
      display: block;
      width: 100%;
      background: var(--blue);
      color: #fff;
      border: none;
      padding: 12px 24px;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.2s ease;
      text-align: center;
    }

    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
    }

    .btn.disconnected {
      background: var(--blue);
    }

    .btn.connected {
      background: var(--green);
      box-shadow: 0 0 15px var(--green-glow);
    }

    .tabs {
      display: flex;
      background: rgba(255,255,255,0.03);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 4px;
    }

    .tab {
      flex: 1;
      background: none;
      border: none;
      color: var(--text-muted);
      padding: 10px;
      border-radius: 8px;
      font-family: inherit;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .tab.active {
      background: var(--card-bg);
      color: var(--green);
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }

    .diagnostic-panel {
      min-height: 240px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 15px;
      position: relative;
    }

    /* ── Visualizer: Rotation ── */
    .wheel-visualizer {
      width: 160px;
      height: 160px;
      border-radius: 50%;
      border: 4px dashed rgba(255,255,255,0.1);
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.05s linear;
    }

    .wheel-visualizer::before {
      content: '';
      position: absolute;
      top: 0;
      width: 4px;
      height: 20px;
      background: var(--green);
      border-radius: 2px;
    }

    .wheel-center {
      width: 120px;
      height: 120px;
      border-radius: 50%;
      background: rgba(255,255,255,0.03);
      border: 1px solid var(--card-border);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }

    .angle-value {
      font-size: 24px;
      font-weight: 800;
      color: var(--green);
    }

    .angle-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-muted);
    }

    /* ── Visualizer: Tilt 2D ── */
    .tilt-visualizer {
      width: 200px;
      height: 200px;
      border: 1px solid var(--card-border);
      background: rgba(255,255,255,0.02);
      border-radius: 12px;
      position: relative;
      overflow: hidden;
    }

    .tilt-grid {
      position: absolute;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }

    .tilt-grid::before {
      content: '';
      position: absolute;
      left: 50%;
      width: 1px;
      height: 100%;
      background: rgba(255,255,255,0.08);
    }

    .tilt-grid::after {
      content: '';
      position: absolute;
      top: 50%;
      height: 1px;
      width: 100%;
      background: rgba(255,255,255,0.08);
    }

    .tilt-pointer {
      position: absolute;
      width: 16px;
      height: 16px;
      background: var(--green);
      border-radius: 50%;
      border: 2px solid #fff;
      transform: translate(-50%, -50%);
      left: 50%;
      top: 50%;
      transition: all 0.05s ease-out;
      box-shadow: 0 0 10px var(--green);
    }

    /* ── Numbers Table ── */
    .stats-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }

    .stats-table th, .stats-table td {
      padding: 8px 12px;
      text-align: left;
      font-size: 13px;
    }

    .stats-table th {
      color: var(--text-muted);
      font-weight: 600;
      border-bottom: 1px solid var(--card-border);
    }

    .stats-table td {
      font-family: monospace;
      font-size: 14px;
      border-bottom: 1px solid rgba(255,255,255,0.02);
    }

    .stats-table td.highlight {
      color: var(--green);
      font-weight: bold;
    }

    .actions-row {
      display: flex;
      gap: 10px;
      margin-top: 15px;
    }

    .btn-secondary {
      background: rgba(255,255,255,0.06);
      border: 1px solid var(--card-border);
      color: var(--text-main);
      padding: 10px 16px;
      border-radius: 10px;
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-secondary:hover {
      background: rgba(255,255,255,0.1);
    }

    /* ── Report Card ── */
    .report-textarea {
      width: 100%;
      height: 120px;
      background: rgba(0,0,0,0.25);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      color: #38bdf8;
      font-family: monospace;
      font-size: 12px;
      padding: 10px;
      resize: none;
      margin-top: 10px;
    }
  </style>
</head>
<body>

<div class="container">
  <header>
    <h1>🐸 Triki Diagnostyka</h1>
    <p>Narzędzie testowe do kalibracji obrotu i wychylenia kontrolera</p>
  </header>

  <!-- Connect Card -->
  <div class="card">
    <button id="status-btn" class="btn disconnected">🔌 Szukaj Kapsla BLE</button>
  </div>

  <!-- Mode Tabs -->
  <div class="tabs">
    <button class="tab active" data-mode="wheel">🔄 Obrót (Z-Gyro)</button>
    <button class="tab" data-mode="tilt">📐 Wychylenie (Tilt)</button>
  </div>

  <!-- Visualizer Card -->
  <div class="card" style="display: flex; flex-direction: column; align-items: center;">
    <!-- Panel: Obrót -->
    <div id="panel-wheel" class="diagnostic-panel">
      <div id="rotation-circle" class="wheel-visualizer">
        <div class="wheel-center">
          <span id="integ-angle" class="angle-value">0.0°</span>
          <span class="angle-label">Kąt obrotu</span>
        </div>
      </div>
      <div style="font-size: 12px; color: var(--text-muted); text-align: center;">
        Obracaj kapslem jak pokrętłem wokół własnej osi.<br>
        10° obrotu = 1 krok w menu klawiatury.
      </div>
    </div>

    <!-- Panel: Wychylenie -->
    <div id="panel-tilt" class="diagnostic-panel" style="display: none;">
      <div class="tilt-visualizer">
        <div class="tilt-grid"></div>
        <div id="target-indicator" class="tilt-pointer"></div>
      </div>
      <div style="font-size: 12px; color: var(--text-muted); text-align: center;">
        Przechylaj kapsel w lewo/prawo (oś pozioma)<br>
        oraz w przód/tył (oś pionowa).
      </div>
    </div>

    <!-- Reset / Control Row -->
    <div class="actions-row" style="width: 100%; justify-content: center;">
      <button id="btn-reset" class="btn-secondary">🔄 Zresetuj kąt (do zera)</button>
      <button id="btn-drift-cal" class="btn-secondary">🎯 Kalibruj dryf (neutral)</button>
    </div>

    <!-- Invert Checkbox -->
    <div style="margin-top: 15px; display: flex; justify-content: center;">
      <label style="font-size: 14px; color: var(--text-muted); display: flex; align-items: center; gap: 8px; cursor: pointer;">
        <input type="checkbox" id="chk-invert-x" style="width: 16px; height: 16px; accent-color: var(--green);">
        🔄 Odwróć obrót (Rewers kapsla)
      </label>
    </div>
  </div>

  <!-- Live Values Card -->
  <div class="card">
    <h3 style="font-size: 15px; font-weight: 600; margin-bottom: 10px; color: var(--text-muted);">Dane z czujników (live)</h3>
    <table class="stats-table">
      <thead>
        <tr>
          <th>Sygnał</th>
          <th>Wartość</th>
          <th>Sygnał przetworzony</th>
          <th>Wynik</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Raw GX (gyro X)</td>
          <td id="raw-gx">0.00</td>
          <td><b>GX()</b> (pion)</td>
          <td id="proc-gx" class="highlight">0.00</td>
        </tr>
        <tr>
          <td>Raw GY (gyro Y)</td>
          <td id="raw-gy">0.00</td>
          <td><b>GZ()</b> (poziom)</td>
          <td id="proc-gz" class="highlight">0.00</td>
        </tr>
        <tr>
          <td>Raw GZ (gyro Z)</td>
          <td id="raw-gz">0.00</td>
          <td><b>ROT()</b> (obrót)</td>
          <td id="proc-rot" class="highlight">0.00</td>
        </tr>
        <tr>
          <td>Raw AX (accel X)</td>
          <td id="raw-ax">0.000</td>
          <td>Przycisk fizyczny</td>
          <td id="btn-state">PUSZCZONY</td>
        </tr>
        <tr>
          <td>Raw AY (accel Y)</td>
          <td id="raw-ay">0.000</td>
          <td>Drift GZ (offset)</td>
          <td id="drift-offset">0.00</td>
        </tr>
        <tr>
          <td>Raw AZ (accel Z)</td>
          <td id="raw-az">0.000</td>
          <td>Kalibracja V2</td>
          <td id="calib-v2">Brak</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Report Card -->
  <div class="card">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <h3 style="font-size: 15px; font-weight: 600; color: var(--text-muted);">Raport dla Antigravity</h3>
      <button id="btn-copy-report" class="btn-secondary" style="padding: 6px 12px; font-size: 11px;">📋 Kopiuj raport</button>
    </div>
    <textarea id="report-text" class="report-textarea" readonly placeholder="Połącz kapsel i obróć go, aby wygenerować raport..."></textarea>
  </div>
</div>

<script src="/static/triki.js?v=202606121710"></script>
<script>
  const triki = new TrikiController();
  let currentMode = 'wheel';
  let cumulativeAngle = 0; // zintegrowany kąt obrotu
  let wasConnected = false;
  let lastTime = 0;

  // ── Blokowanie wygaszania ekranu (Wake Lock) ──
  let wakeLock = null;
  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('Wake Lock active');
    } catch (err) {
      console.warn('Wake Lock error:', err.message);
    }
  }
  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().then(() => { wakeLock = null; });
    }
  }
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && triki.connected) {
      await requestWakeLock();
    }
  });

  // Aktywacja BLE
  document.getElementById('status-btn').onclick = () => {
    triki.connect().catch(err => {
      console.warn("Błąd połączenia:", err);
    });
  };

  // Zakładki
  document.querySelectorAll('.tab').forEach(button => {
    button.onclick = () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      button.classList.add('active');
      currentMode = button.dataset.mode;

      if (currentMode === 'wheel') {
        document.getElementById('panel-wheel').style.display = 'flex';
        document.getElementById('panel-tilt').style.display = 'none';
        triki.scheme = 'rotate';
      } else {
        document.getElementById('panel-wheel').style.display = 'none';
        document.getElementById('panel-tilt').style.display = 'flex';
        triki.scheme = 'tilt';
      }
      resetAngle();
    };
  });

  // Sterowanie
  document.getElementById('btn-reset').onclick = () => resetAngle();
  document.getElementById('btn-drift-cal').onclick = () => {
    if (triki.connected) {
      triki.calibrateNeutral();
      document.getElementById('drift-offset').textContent = triki._rotDrift.toFixed(2);
      resetAngle();
      alert("Skalibrowano dryf żyroskopu! Ustawiono offset na: " + triki._rotDrift.toFixed(2) + " °/s");
    } else {
      alert("Najpierw połącz kontroler BLE!");
    }
  };

  function resetAngle() {
    cumulativeAngle = 0;
    document.getElementById('integ-angle').textContent = "0.0°";
    const circle = document.getElementById('rotation-circle');
    if (circle) circle.style.transform = `rotate(0deg)`;
  }

  // Kopiowanie raportu
  document.getElementById('btn-copy-report').onclick = () => {
    const txt = document.getElementById('report-text');
    txt.select();
    document.execCommand('copy');
    alert("Raport skopiowany do schowka! Wklej go w oknie chatu z Antigravity 🐾");
  };

  // Obsługa odwrócenia osi
  const chkInvertX = document.getElementById('chk-invert-x');
  chkInvertX.onchange = (e) => {
    triki.setInvert('x', e.target.checked);
  };

  // Główna pętla diagnostyczna
  function update(timestamp) {
    requestAnimationFrame(update);
    if (!lastTime) lastTime = timestamp;
    const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
    lastTime = timestamp;

    if (triki.connected) {
      if (!wasConnected) {
        wasConnected = true;
        const btn = document.getElementById('status-btn');
        btn.textContent = "✅ Połączono: " + triki.name;
        btn.className = "btn connected";
        triki.scheme = currentMode === 'wheel' ? 'rotate' : 'tilt';
        // Auto-drift na start
        triki.calibrateNeutral();
        document.getElementById('drift-offset').textContent = triki._rotDrift.toFixed(2);
        chkInvertX.checked = triki.invertX; // zsynchronizuj stan
        requestWakeLock(); // Aktywuj blokadę wygaszania
        resetAngle();
      }

      // Aktualizacja wartości surowych
      document.getElementById('raw-gx').textContent = triki.gx.toFixed(2);
      document.getElementById('raw-gy').textContent = triki.gy.toFixed(2);
      document.getElementById('raw-gz').textContent = triki.gz.toFixed(2);
      document.getElementById('raw-ax').textContent = triki.ax.toFixed(3);
      document.getElementById('raw-ay').textContent = triki.ay.toFixed(3);
      document.getElementById('raw-az').textContent = triki.az.toFixed(3);
      document.getElementById('btn-state').textContent = triki._btn ? "WCIŚNIĘTY" : "PUSZCZONY";

      // Pobieranie przetworzonych wartości
      const gxVal = triki.GX();
      const gzVal = triki.GZ();
      const rotVal = triki.ROT();

      document.getElementById('proc-gx').textContent = gxVal.toFixed(2);
      document.getElementById('proc-gz').textContent = gzVal.toFixed(2);
      document.getElementById('proc-rot').textContent = rotVal.toFixed(2);
      document.getElementById('calib-v2').textContent = triki._calibV2 ? "Tak" : "Brak";

      // Integracja kąta dla Z-Gyro (Drift compensated)
      // Do czystego kąta fizycznego używamy rzeczywistej prędkości z kompensacją dryfu i kierunkiem rewersu:
      const ix = triki._ix; // -1 lub 1
      const correctedGz = (triki.gz - triki._rotDrift) * ix;
      if (Math.abs(correctedGz) > 1.5) {
        cumulativeAngle += correctedGz * dt;
      }
      
      document.getElementById('integ-angle').textContent = cumulativeAngle.toFixed(1) + "°";

      // Aktualizacja wizualizacji obrotu
      const circle = document.getElementById('rotation-circle');
      if (circle && currentMode === 'wheel') {
        circle.style.transform = `rotate(${cumulativeAngle}deg)`;
      }

      // Aktualizacja wizualizacji wychylenia
      const target = document.getElementById('target-indicator');
      if (target && currentMode === 'tilt') {
        // Skalowanie: GX i GZ mają zwykle wartości w zakresie -30..30
        const maxR = 25;
        const pctX = 50 - (gzVal / maxR) * 50; 
        const pctY = 50 + (gxVal / maxR) * 50; 
        target.style.left = `${Math.max(0, Math.min(100, pctX))}%`;
        target.style.top = `${Math.max(0, Math.min(100, pctY))}%`;
      }

      // Aktualizacja raportu tekstowego
      const report = `=== TRIKI DIAGNOSTIC REPORT ===\n` +
                     `Czas: ${new Date().toISOString()}\n` +
                     `Urządzenie: ${triki.name} (${triki.deviceId})\n` +
                     `Tryb testowy: ${currentMode === 'wheel' ? 'Obrót (ROT)' : 'Wychylenie (TILT)'}\n` +
                     `Dryf GZ (offset): ${triki._rotDrift.toFixed(3)} °/s\n` +
                     `Zintegrowany Kąt: ${cumulativeAngle.toFixed(2)} stopni\n` +
                     `Przetworzone GX: ${gxVal.toFixed(3)}\n` +
                     `Przetworzone GZ: ${gzVal.toFixed(3)}\n` +
                     `Przetworzone ROT: ${rotVal.toFixed(3)}\n` +
                     `Surowy Gyro: [${triki.gx.toFixed(2)}, ${triki.gy.toFixed(2)}, ${triki.gz.toFixed(2)}]\n` +
                     `Surowy Accel: [${triki.ax.toFixed(3)}, ${triki.ay.toFixed(3)}, ${triki.az.toFixed(3)}]\n` +
                     `Przycisk fizyczny: ${triki._btn ? 'WCIŚNIĘTY' : 'PUSZCZONY'}\n` +
                     `Kalibracja V2: ${JSON.stringify(triki._calibV2 || null)}\n` +
                     `Czułość: ${(triki.sensitivity * 100).toFixed(0)}%\n` +
                     `================================`;
      document.getElementById('report-text').value = report;

    } else {
      if (wasConnected) {
        wasConnected = false;
        const btn = document.getElementById('status-btn');
        btn.textContent = "🔌 Szukaj Kapsla BLE";
        btn.className = "btn disconnected";
        releaseWakeLock(); // Zwolnij blokadę wygaszania
      }
    }
  }

  requestAnimationFrame(update);
</script>
</body>
</html>
