# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workspace Overview

Three separate sub-projects sharing a common subject: the **Triki od Żabki** BLE game controller (a capsule-shaped accelerometer/gyroscope device from the Polish Żabka convenience chain).

| Subproject | Tech | Purpose |
|---|---|---|
| `triki_app/` | Flutter + Kotlin | Android app: turns Triki into a system mouse |
| `gry/` | Python (stdlib) + Vanilla JS | Web-based mini-game hub controlled by Triki BLE |
| `TrikiReader/` | C# / WPF / .NET 9 | Windows diagnostic tool: BLE read + 3D IMU visualization |

## Shared BLE Protocol (all three projects)

- **Service UUID (NUS):** `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
- **RX (write commands):** `6e400002-b5a3-f393-e0a9-e50e24dcca9e`
- **TX (notifications):** `6e400003-b5a3-f393-e0a9-e50e24dcca9e`
- **Init command (hex → RX):** `201000D007680003`
- **Frame (14 bytes):** `[0x22][button: 0x00/0x01][gyroX LE][gyroY LE][gyroZ LE][accelX LE][accelY LE][accelZ LE]`
  - Gyroscope scale: `131.0`, Accelerometer scale: `2048.0`

---

## `gry/` — Web Game Hub

**Full documentation: `gry/README.md`** (architecture, BLE protocol, game contract, testing).

**Start the server:**
```bash
python3 gry/gryzabka.py          # port 8797 (default)
python3 gry/gryzabka.py 8888     # custom port
```

**Server is `gryzabka.py` — never `server.py`** (that name conflicts with other servers on the malina machine).

**After any change** — update `<p class="hub-version">` in `index.html` with current date/time AND bump the `?v=` cache-busters on `style.css`, `triki.js`, `app.js`.

**Deploy to production (gry.kawak.pl):**
```bash
cd ~/projekty/zabka && rsync -avz --exclude='data/' --exclude='__pycache__/' --exclude='*.log' gry/ malina:/home/kawak/gry/
```
`data/` exclusion is mandatory (player scores/profiles live there). No server restart needed for HTML/JS/CSS changes.

### Architecture

- `gryzabka.py` — pure stdlib HTTP server; serves static files + REST API (`/api/games`, `/api/scores/<id>`, `/api/players`, `/api/triki-devices`, `/api/log`)
- `index.html` — single-page hub: BLE connection, player profile, settings modal (⚙️), game selection, leaderboards
- `static/triki.js` — `TrikiController`: BLE, axis schemes (`tilt`/`swing`/`rotate`), calibration, sensitivity + axis-invert settings (localStorage)
- `static/gameutils.js` — shared ES module for games (clamp, rand, pick, lerp, drawGrid, radialGlow, drawHintBubble)
- `games/<id>/` — one directory per game (`meta.json` + `game.js` ES module); `_`-prefixed dirs ignored

7 games: catch, snake, frog, maze, pong (Arkanoid), shooter, crawler (Dungeon — floor 1 is a tutorial with hint bubbles).

### Adding a New Game

Copy `games/_template/` — full contract documented in `gry/README.md` and in the template itself. Key gotchas:
- Initialize ALL game state in the constructor — `drawIdle()` can be called BEFORE `start()`
- Axis convention: horizontal = `-triki.GZ()`, vertical = `+triki.GX()`
- `emit('end', {score})` posts to leaderboard; optional `won: true/false` changes the end-screen title
- Import shared utils via relative path: `'../../static/gameutils.js'` (works in browser and Node tests)

Persistent data lives in `gry/data/` (server only): `scores/<id>.json`, `players.json`, `logs/`.

---

## `triki_app/` — Flutter Android App

**Dev workflow (must build on `minionek`, not Termux):**
```bash
# 1. Sync from Termux to build machine
rsync -avz --exclude='build/' --exclude='.dart_tool/' --exclude='.idea/' \
  --exclude='android/.gradle/' --exclude='local.properties' \
  ~/projekty/zabka/triki_app/ minionek:~/projekty/zabka/triki_app/

# 2. Build + release on minionek
ssh minionek "bash ~/projekty/zabka/triki_app/deploy_workflow.sh"
```

**Local Flutter commands (run on minionek):**
```bash
flutter run                    # dev mode with hot reload
flutter build apk --debug
flutter doctor                 # check SDK environment
flutter logs                   # device log stream
```

### Architecture

- `lib/main.dart` — BLE scanning/connection, mouse logic (air mode: gyroscope yaw+pitch; table mode: accelerometer with damping `0.82`), click gesture detection (short <400ms = LPM, double = double-click, long >550ms = PPM, hold+tilt = scroll), calibration wizard, profile storage via `shared_preferences`
- `lib/games_page.dart` — 3 built-in gyroscope mini-games (Catch the Dot, Gyro Pong, Żabka łapie muchy); pauses mouse mode while active
- `android/.../TrikiAccessibilityService.kt` — `AccessibilityService` that draws a neon-green cursor overlay (`TYPE_ACCESSIBILITY_OVERLAY`) and dispatches `dispatchGesture` events; communicates with Dart via `MethodChannel` (`pl.kawak.triki_app/mouse`)
- `android/.../MainActivity.kt` — hosts the `MethodChannel`; manages persistent BLE status notification

**Deploy script** (`deploy_workflow.sh`) auto-increments the patch version in `pubspec.yaml`, builds release APK, commits and tags, then creates releases on both Gitea (`git.kawak.pl/kawak/Triki`) and GitHub (`kawaczek/triki`).

---

## `TrikiReader/` — Windows WPF Diagnostic Tool

**Build and run (Windows only, .NET 9):**
```powershell
dotnet build
dotnet run --project TrikiReader.csproj
dotnet test
```

### Architecture

- `TrikiCore.cs` — `TrikiBleReader`: BLE scanning (looks for device name containing `Triki`), NUS connection, 14-byte frame parser, fires `SampleReceived` events
- `MadgwickAHRS.cs` — sensor fusion filter combining gyro + accel into quaternion orientation
- `ComplementaryTiltOrientationMapper.cs` / `VisualOrientationMapper.cs` — map quaternion to 3D render transforms
- `MainWindow.xaml.cs` — WPF UI: real-time 3D capsule visualization + 3-axis gyroscope graph
- `UiUpdateGate.cs` — rate-limits UI redraws
- `TrikiReader.Tests/` — unit tests for frame parser, IMU unit conversion, orientation filter convergence
