#!/bin/bash
# Automatyczny skrypt budowania i wdrażania (Automated Build & Deploy Workflow)
# Ten skrypt jest uruchamiany na Minionku.

set -e # Przerwij przy jakimkolwiek błędzie

echo "=== [1/4] Rozpoczynanie budowania wersji Release APK ==="
cd ~/projekty/zabka/triki_app
/home/kawak/sdk/flutter/bin/flutter build apk --release --no-tree-shake-icons

echo "=== [2/4] Kopiowanie plików do lokalnego repozytorium git ==="
# Czyszczenie starej wersji kodu w repozytorium
rm -rf ~/projekty/zabka/Triki/triki_app
# Kopiowanie czystego kodu źródłowego
rsync -av --exclude='build/' --exclude='.dart_tool/' --exclude='.idea/' --exclude='android/.gradle/' --exclude='local.properties' ~/projekty/zabka/triki_app/ ~/projekty/zabka/Triki/triki_app/
# Kopiowanie gotowego pliku APK
cp ~/projekty/zabka/triki_app/build/app/outputs/flutter-apk/app-release.apk ~/projekty/zabka/Triki/triki_app.apk

echo "=== [3/4] Przygotowanie commitu w repozytorium git ==="
cd ~/projekty/zabka/Triki
git config user.name "Oberon"
git config user.email "oberon@kawak.pl"
git add -A

# Sprawdzenie czy są jakieś zmiany do commita
if git diff-index --quiet HEAD --; then
    echo "Brak zmian do zatwierdzenia."
else
    echo "Tworzenie commitu..."
    git commit -m "Automatyczny deploy: nowa wersja APK i aktualizacja kodu źródłowego ($(date '+%Y-%m-%d %H:%M:%S'))"
    
    echo "=== [4/4] Wypychanie zmian do Gitea (HTTPS) i GitHub ==="
    git push origin main
    git push github main
    echo "=== Wdrożenie zakończone sukcesem! 🐾 ==="
fi
