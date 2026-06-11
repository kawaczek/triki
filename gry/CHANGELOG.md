# Changelog — Triki Gry

## 2026-06-11 10:57 — Dungeon 2.0, tryby sterowania, fix poziomów Arkanoida

### 🏰 Triki Dungeon 2.0 — pełne przepisanie pod grywalność na telefonie
- **Usunięta mgła wojny** — jasny, czytelny loch (tylko delikatna winieta na brzegach)
- **Sterowanie bezpośrednie**: przechył kapsla = ruch żabki (latający kursor usunięty — to on był nieużywalny)
- **Auto-celowanie**: strzał sam namierza najbliższego wroga (przerywany czerwony krąg pokazuje cel)
- **Minimapka** w prawym górnym rogu: pokoje, schody, skrzynie, wrogowie, pozycja gracza
- Jasna paleta: ściany #3f4c7d z rozświetleniem, podłoga #232c4e
- Tryby sterowania: przechył / machnięcie (wybór przed grą)

### 🎮 Wybór trybu sterowania kapslem (ekran startowy gry)
- Mechanizm generyczny: `meta.json` → `ctrlModes`, wybór zapamiętywany per gra (`ctrlmode_<id>`)
- **Arkanoid**: 🔄 obracaj kapslem / ↔️ przechylaj / 👋 machaj na boki
- **Wąż**: ↔️ przechył / 👋 machnięcie / 🔄 obrót = skręt względny (CW = w prawo, z zatrzaskiem)
- Przyciski widoczne tylko przy podłączonym kapslu

### 🐛 Naprawione
- **Arkanoid nie przechodził na kolejny poziom** po zbiciu wszystkich klocków — licznik
  klocków liczony po odfiltrowaniu zamiast przed, warunek wygranej nigdy nie był spełniony.
  Dodany test regresji (pełne przejście poziomów 1→6 + wygrana).

## 2026-06-11 10:41 — Wielka rozbudowa: ustawienia, poziomy, 3 nowe gry

### Refaktoryzacja
- Nowy wspólny moduł `static/gameutils.js` (clamp, rand, pick, lerp, drawGrid, radialGlow, drawHintBubble) — usunięte duplikaty z każdej gry
- Szablon `_template` zaktualizowany o import gameutils i ostrzeżenie o `drawIdle()` przed `start()`
- Pełna dokumentacja w `README.md`

### Ustawienia sterowania kapsla ⚙️
- Modal ustawień dostępny z huba i z nagłówka każdej gry
- Czułość 20–300%, odwracanie osi poziomej/pionowej, rekalibracja
- Otwarcie ustawień w trakcie gry pauzuje rozgrywkę
- `TrikiController.setInvert()` / `setSensitivity()` — zapis w localStorage

### Nowe gry (4 → 7)
- 🐍 **Wąż Triki** — klasyczny snake; przechył wybiera kierunek; poziom co 5 jabłek, od poz. 3 kamienie
- 🌀 **Labirynt Kulka** — kulka toczona przechyłem przez 5 plansz z dziurami; 3 życia, bonus za czas; każda plansza ma zweryfikowaną (BFS) bezpieczną trasę
- 🚀 **Kosmo Żaba** — strzelanka: żabka w spodku, fale wrogów, poziom co 12 zestrzeleń

### Poziomy w istniejących grach
- 🎯 Catch the Dot: poziom co 8 pkt (szybszy spawn, krótsze życie kropek), złote kropki ✨ = 3 pkt
- 🐸 Żabka łapie muchy: system poziomów (złap 4+N much → +9 s), od poz. 2 osy 🐝 (-2 pkt za trafienie)
- 🧱 Triki Arkanoid: +3 nowe układy poziomów (Twierdza, Zygzak, Finałowy mur) — razem 6

### Triki Dungeon — tutorial i jaśniejsza paleta
- Jaśniejsze ściany (#37306b/#7c74d4) i podłoga (#1b163a), słabsza mgła wojny, większy zasięg światła (3.2 → 4.6 kafelka)
- Piętro 1 = tutorial: dymki z podpowiedziami sterowania (inne dla BLE i myszy), maks. 1 wróg na pokój

## 2026-06-11 09:57 — Naprawa bugów + szlif wizualny

- **Fix:** Arkanoid zamarzał przy strzale laserem (niezdefiniowane `H` w `update()`)
- **Fix:** kreator kalibracji crashował na końcu (`h.axis`/`v.axis` nie istniały)
- **Fix:** kalibracja była zapisywana pod innym kluczem niż czytał kontroler — nigdy nie działała
- **Fix:** Żabka i Dungeon crashowały w `drawIdle()` przed `start()`
- **Fix:** Arkanoid nie zapisywał wyników na leaderboard (kończył się jak Pong)
- Karty gier ostylowane zgodnie z CSS (ikona, plakietka trudności, przycisk GRAJ, lokalny rekord, animacja)
- Naprawione niewidoczne paski żyroskopu i kropka koloru gracza
- Nagłówek tabeli wyników, pulsujący START, favicon 🐸, Enter zapisuje nick

## 2026-06-10 — Pierwsza wersja huba

- Serwer `gryzabka.py` (stdlib), hub SPA, profile graczy, leaderboardy
- TrikiController (Web Bluetooth, NUS), kalibracja, czułość
- 4 gry: Catch the Dot, Triki Arkanoid, Żabka łapie muchy, Triki Dungeon
