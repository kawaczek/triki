# Triki Gry 🐸 — gry.kawak.pl

Hub minigier przeglądarkowych sterowanych kapslem **Triki od Żabki** przez Web Bluetooth (BLE).
Działa też bez kapsla — myszką, palcem lub klawiaturą.

**Produkcja:** https://gry.kawak.pl (malina, `/home/kawak/gry/`, port 8797)

---

## Uruchomienie

```bash
python3 gryzabka.py          # port 8797 (domyślny)
python3 gryzabka.py 8888     # inny port
```

Serwer to czysta biblioteka standardowa Pythona (zero zależności).
**Uwaga:** plik nazywa się `gryzabka.py`, nigdy `server.py` (pkill `server.py` zabiłby inne serwery na malinie).

## Deploy na produkcję

```bash
cd ~/projekty/zabka
rsync -avz --exclude='data/' --exclude='__pycache__/' --exclude='*.log' gry/ malina:/home/kawak/gry/
```

- `--exclude='data/'` **obowiązkowe** — tam żyją wyniki graczy i profile.
- Restart serwera niepotrzebny przy zmianach w HTML/JS/CSS (pliki czytane z dysku przy każdym żądaniu). Restart tylko gdy zmieni się `gryzabka.py`.
- Po każdej zmianie podbij `<p class="hub-version">` w `index.html` oraz parametry `?v=` przy `style.css`, `triki.js` i `app.js` (cache-bustery).

---

## Architektura

```
gry/
├── gryzabka.py          # serwer HTTP + REST API (stdlib only)
├── index.html           # SPA: hub, modale (nick, ustawienia), widok gry
├── static/
│   ├── style.css        # cały wygląd (dark theme, karty gier, modale)
│   ├── triki.js         # TrikiController — BLE, osie, kalibracja, ustawienia
│   ├── app.js           # logika huba: profile, karty, pętla gry, leaderboard
│   └── gameutils.js     # wspólny ES-module dla gier (clamp, drawGrid, glow…)
├── games/<id>/
│   ├── meta.json        # tytuł, emoji, opis, sterowanie, scheme, order
│   └── game.js          # ES-module z klasą gry (default export)
└── data/                # TYLKO NA SERWERZE — nie nadpisywać!
    ├── scores/<id>.json # top-500 wyników per gra
    ├── players.json     # profile graczy (klucz: device_id)
    └── logs/            # CSV z czujników (endpoint /api/log)
```

### REST API (`gryzabka.py`)

| Endpoint | Metoda | Opis |
|---|---|---|
| `/api/games` | GET | lista gier z meta.json (sort po `order`) |
| `/api/scores/<id>` | GET/POST | tabela wyników gry / zapis wyniku |
| `/api/players` | GET/POST | profile graczy |
| `/api/triki-devices` | GET | znane kapsle (nazwa → nick, kolor) |
| `/api/log` | POST | zrzut próbek IMU do CSV |

---

## Protokół BLE kapsla (Nordic UART Service)

- Service: `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
- RX (komendy): `6e400002-…`, TX (strumień): `6e400003-…`
- Komenda startowa (hex na RX): `20 10 00 D0 07 68 00 03`
- Ramka 14 B: `[0x22][przycisk][gyroX][gyroY][gyroZ][accX][accY][accZ]` (int16 LE)
- Skale: żyroskop `/131.0` → °/s, akcelerometr `/2048.0` → g

### TrikiController (`static/triki.js`)

Trzy **schematy sterowania** (gra deklaruje w `meta.json` → `"scheme"`):

| Scheme | Czujnik | Użycie |
|---|---|---|
| `tilt` | akcelerometr | kapsel płasko, przechylasz jak kierownicę |
| `swing` | żyroskop | machasz/obracasz kapslem w dłoni |
| `rotate` | żyroskop Z | obracasz kapslem jak pokrętłem (Arkanoid) |

API dla gier:
- `triki.GX(deadzone?)` — oś pozioma po kalibracji, czułości i odwróceniu
- `triki.GZ(deadzone?)` — oś pionowa (j.w.)
- `triki.ROT(deadzone?)` — obrót (gyro Z)
- `triki.consumeClick()` — zjada pojedyncze kliknięcie fizycznego guzika
- `triki.connected` — czy kapsel podłączony

**Konwencja osi w grach:** ruch poziomy = `-GZ()`, ruch pionowy = `+GX()`
(tak używają wszystkie gry — trzymaj się tego w nowych).

### Tryby sterowania per gra (`ctrlModes`)

Gra może zadeklarować w `meta.json` listę trybów wybieranych na ekranie startowym
(widoczne tylko przy podłączonym kapslu, wybór zapamiętywany w `ctrlmode_<gameId>`):

```json
"ctrlModes": [
  { "id": "rotate", "label": "🔄 Obracaj kapslem", "scheme": "rotate" },
  { "id": "tilt",   "label": "↔️ Przechylaj",      "scheme": "tilt"   },
  { "id": "swing",  "label": "👋 Machaj",           "scheme": "swing"  }
]
```

`app.js` ustawia `triki.scheme` wg wyboru; gra czyta `localStorage.getItem('ctrlmode_<id>')`
i dobiera czułość/logikę (np. wąż w trybie `rotate` skręca względnie: CW = w prawo).
Używają: Arkanoid (3 tryby), Wąż (3 tryby), Dungeon (2 tryby).

### Ustawienia sterowania (modal ⚙️)

Dostępny z huba (przy panelu BLE) i z nagłówka każdej gry. Otwarcie w trakcie gry **pauzuje** pętlę.

| Ustawienie | Klucz localStorage |
|---|---|
| Czułość 20–300% | `triki_sensitivity` |
| Odwróć oś poziomą | `triki_invert_x` |
| Odwróć oś pionową | `triki_invert_y` |
| Kalibracja osi (kreator 2-krokowy) | `triki_calib` (tilt) / `triki_calib_swing` |

---

## Gry (7)

| # | Gra | Scheme | Poziomy / progresja |
|---|---|---|---|
| 1 | 🎯 Catch the Dot | swing | poziom co 8 pkt: szybszy spawn, krótsze życie kropek; złote ✨ = 3 pkt |
| 2 | 🐍 Wąż Triki | tilt | poziom co 5 jabłek (szybciej); od poz. 3 kamienie 🪨 |
| 3 | 🐸 Żabka łapie muchy | tilt | poziom = złap 4+N much (+9 s bonusu); od poz. 2 osy 🐝 (-2 pkt) |
| 4 | 🌀 Labirynt Kulka | tilt | 5 plansz, dziury, 3 życia; bonus za czas |
| 5 | 🧱 Triki Arkanoid | rotate | 6 układów klocków, power-upy (laser, multiball, expand, serce) |
| 6 | 🚀 Kosmo Żaba | tilt | poziom co 12 zestrzeleń: szybszy spawn, mocniejsi wrogowie; 3 życia |
| 7 | 🏰 Triki Dungeon **2.0** | tilt | roguelike bez mgły wojny: przechył = ruch żabki, strzał z auto-celowaniem, minimapka; **piętro 1 = tutorial** |

---

## Dodawanie nowej gry

1. Skopiuj `games/_template/` → `games/nazwa/` (katalogi z `_` są ignorowane).
2. Uzupełnij `meta.json` (tytuł, emoji, opis, `scheme`, `order`, sterowanie).
3. Napisz klasę w `game.js` — **kontrakt** (wszystkie metody wymagane):

```js
constructor(canvas, ctx, triki, emit)
start(player)        // player: {nick, color, deviceId} | null
update(dt)           // dt w ms (cap 100 ms)
draw(dt)
resize(W, H)
onMouseMove(nx, ny)  // [0,1]; wywoływane tylko gdy !triki.connected
onClick(nx, ny)
onKeyDown(code)      // + opcjonalnie onKeyUp(code)
drawIdle()           // tło ekranu startowego — może iść PRZED start()!
destroy()
running              // boolean — false kończy pętlę
```

4. `emit('stats', html)` — pasek statystyk; `emit('end', {score})` — koniec gry
   (opcjonalnie `{score, won: true/false}` — zmienia nagłówek ekranu końca).
5. Wspólne narzędzia: `import { clamp, rand, pick, lerp, drawGrid, radialGlow, drawHintBubble } from '../../static/gameutils.js';`

**Pułapki:**
- Inicjalizuj cały stan w **konstruktorze** — `drawIdle()` bywa wołane przed `start()`.
- Pozycje trzymaj znormalizowane [0,1] albo konsekwentnie w px — nie mieszaj (patrz historia bugu lasera w Arkanoidzie).
- `meta.json` z `"hasScore": true` → wynik z `emit('end', {score})` trafia na leaderboard.

---

## Testowanie bez przeglądarki

Gry da się przetestować w Node (ES-moduły + mock canvasa przez `Proxy`):
mock `ctx` zwraca no-opy, `createRadialGradient` → `{addColorStop(){}}`,
`measureText` → `{width}`; mock `triki` z `GX/GZ/ROT/consumeClick`.
Symuluj `start() → update(16)/draw()` w pętli, sprawdź `emit('end')`.
Dla labiryntu: walidacja plansz (długości wierszy, dokładnie 1×S i 1×E,
BFS bezpiecznej trasy S→E z dziurami jako przeszkodami).
