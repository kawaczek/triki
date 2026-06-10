# Triki Mouse - Mobilny Kontroler Myszy Android 🐾

Projekt ten implementuje w pełni natywne, systemowe sterowanie kursorem myszy na urządzeniach z systemem Android za pomocą kontrolera do gier **Triki od Żabki** (komunikującego się przez Bluetooth Low Energy).

Aplikacja mobilna została napisana w technologii **Flutter**, a obsługa ruchów systemowych oraz nakładki kursora w języku **Kotlin** jako usługa dostępności systemu Android (`AccessibilityService`).

---

## 🚀 Jak działa projekt?

1. **Komunikacja BLE:**
   * Łączy się z usługą **Nordic UART Service (NUS)**:
     * Service: `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
     * RX (Zapis komend): `6e400002-b5a3-f393-e0a9-e50e24dcca9e`
     * TX (Strumień danych): `6e400003-b5a3-f393-e0a9-e50e24dcca9e`
   * Do RX wysyłana jest komenda inicjalizująca: `201000D007680003` w formacie hex.
2. **Format Ramki Danych (14 bajtów):**
   ```text
   [0x22] [StanPrzycisku] [GyroX_LE] [GyroY_LE] [GyroZ_LE] [AccelX_LE] [AccelY_LE] [AccelZ_LE]
   ```
   * **Stan przycisku (`frame[1]`):** `0x00` = puszczony, `0x01` = wciśnięty (fizyczny czerwony guzik na boku).
   * Pozostałe osie są przesyłane jako 16-bitowe liczby całkowite ze znakiem (Little Endian).
3. **Usługa Dostępności Androida (`TrikiAccessibilityService`):**
   * Wyświetla na ekranie systemową nakładkę w postaci neonowo-zielonego wskaźnika myszki.
   * Odbiera przesunięcia `(dx, dy)` i kliknięcia za pomocą kanału platformy (`MethodChannel`).
   * Generuje systemowe zdarzenia kliknięcia (`dispatchGesture`) w punkcie, w którym aktualnie znajduje się kursor.

---

## 🛠️ Tryby Pracy (Wybór w Kreatorze)

Aplikacja wspiera dwa unikalne tryby sterowania kursorem:

1. **Tryb Powietrzny (Air Mouse):**
   * Przeznaczony do trzymania kapsla w dłoni i kierowania nim w powietrzu.
   * Wykorzystuje wskazania żyroskopu (Yaw i Pitch).
   * Posiada ustawienie martwej strefy (Deadzone) eliminującej drżenie dłoni.
2. **Tryb Stołowy (Table Mouse):**
   * Przeznaczony do przesuwania kapsla po płaskiej nawierzchni stołu (jak zwykła mysz).
   * Wykorzystuje wskazania akcelerometru liniowego.
   * Skomplikowane szumy akcelerometru są filtrowane i tłumione za pomocą algorytmu **tarcia fizycznego (friction damping)** o współczynniku `0.82`. Zapewnia to natychmiastowe zatrzymanie kursora po zatrzymaniu ruchu ręki i eliminuje dryfowanie.

---

## 🎯 Kreator Kalibracji (Calibration Wizard)

Dla ułatwienia konfiguracji zaimplementowano interaktywny, 4-etapowy proces kalibracji:
1. **Wybór trybu:** Air Mouse lub Table Mouse.
2. **Ustalenie pozycji przycisku:** Wybór kierunku czerwonego przycisku na obudowie (W lewo, Do mnie, W prawo) – kapsel wektorowy (`CustomPainter`) automatycznie obraca się na ekranie, pokazując właściwy chwyt, a osie ruchów są re-mapowane.
3. **Zerowanie czujników (Tare):** Wyznaczenie offsetów poprzez stabilne położenie kapsla na stole.
4. **Gotowe!** Zapis parametrów do pamięci telefonu (`shared_preferences`).

---

## 🤖 Automatyczny Przepływ Wdrożeniowy (Deploy Workflow)

Na Minionku (komputerze kompilacyjnym) przygotowany został skrypt bashowy automatyzujący cały proces kompilacji i udostępniania nowej wersji aplikacji.

### Uruchomienie skryptu wdrożenia z poziomu Termuxa:

Możesz zdalnie zlecić Minionkowi skompilowanie nowej wersji kodu, spakowanie jej do `.apk`, zrobienie commitu w gicie i wypchnięcie zmian na serwer Gitea za pomocą jednej komendy wywołanej w Termuxie:

```bash
# 1. Zsynchronizuj lokalne zmiany z Termuxa na Minionka
rsync -avz --exclude='build/' --exclude='.dart_tool/' --exclude='.idea/' --exclude='android/.gradle/' --exclude='local.properties' ~/projekty/zabka/triki_app/ minionek:~/projekty/zabka/triki_app/

# 2. Uruchom skrypt wdrożeniowy na Minionku
ssh minionek "bash ~/projekty/zabka/triki_app/deploy_workflow.sh"
```

### Co robi skrypt `deploy_workflow.sh`?
1. Kompiluje zoptymalizowaną wersję produkcyjną aplikacji Flutter (`flutter build apk --release`).
2. Kopiuje świeży kod oraz gotowy plik `app-release.apk` do folderu lokalnego repozytorium git.
3. Zapisuje zmiany, tworzy commit z datą i godziną oraz wypycha zmiany do Gitea na adres:
   `https://git.kawak.pl/kawak/Triki.git`

---

## 📱 Przydatne Komendy (Flutter / Android)

* **Uruchomienie w trybie developerskim (Hot Reload):**
  ```bash
  flutter run
  ```
* **Kompilacja wersji debug (testowej):**
  ```bash
  flutter build apk --debug
  ```
* **Sprawdzenie stanu środowiska Flutter/Android SDK:**
  ```bash
  flutter doctor
  ```
* **Wyświetlenie logów urządzenia w czasie rzeczywistym:**
  ```bash
  flutter logs
  ```
