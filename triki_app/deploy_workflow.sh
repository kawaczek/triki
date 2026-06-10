#!/bin/bash
# Automatyczny skrypt budowania i wdrażania (Automated Build & Deploy Workflow)
# Ten skrypt jest uruchamiany na Minionku.
# Automatycznie inkrementuje wersję patch w pubspec.yaml,
# tworzy tag git oraz wydanie na GitHub z plikiem APK.

set -e # Przerwij przy jakimkolwiek błędzie

GITHUB_TOKEN_FILE="$HOME/.github_token"
if [ ! -f "$GITHUB_TOKEN_FILE" ]; then
  echo "BŁĄD: Brak pliku tokenu GitHub: $GITHUB_TOKEN_FILE"
  echo "Utwórz go: echo 'TWÓJ_TOKEN' > ~/.github_token && chmod 600 ~/.github_token"
  exit 1
fi
GITHUB_TOKEN=$(cat "$GITHUB_TOKEN_FILE" | tr -d '[:space:]')
GITHUB_REPO="kawaczek/triki"
PUBSPEC="$HOME/projekty/zabka/triki_app/pubspec.yaml"
APK_PATH="$HOME/projekty/zabka/triki_app/build/app/outputs/flutter-apk/app-release.apk"

# === KROK 0: Automatyczne podbicie wersji patch ===
echo "=== [0/5] Automatyczne podbijanie wersji ==="
CURRENT_VERSION=$(grep '^version:' "$PUBSPEC" | sed 's/version: //' | tr -d '[:space:]')
# Wyciągnij część przed + (np. 1.0.3)
VERSION_NAME=$(echo "$CURRENT_VERSION" | cut -d'+' -f1)
# Wyciągnij build number (np. 4)
BUILD_NUMBER=$(echo "$CURRENT_VERSION" | cut -d'+' -f2)

# Inkrementuj patch (ostatni segment x.y.Z)
MAJOR=$(echo "$VERSION_NAME" | cut -d'.' -f1)
MINOR=$(echo "$VERSION_NAME" | cut -d'.' -f2)
PATCH=$(echo "$VERSION_NAME" | cut -d'.' -f3)
NEW_PATCH=$((PATCH + 1))
NEW_BUILD=$((BUILD_NUMBER + 1))
NEW_VERSION_NAME="$MAJOR.$MINOR.$NEW_PATCH"
NEW_FULL_VERSION="$NEW_VERSION_NAME+$NEW_BUILD"
TAG="v$NEW_VERSION_NAME"

echo "  Stara wersja: $CURRENT_VERSION"
echo "  Nowa wersja:  $NEW_FULL_VERSION (tag: $TAG)"

# Zaktualizuj pubspec.yaml
sed -i "s/^version: .*/version: $NEW_FULL_VERSION/" "$PUBSPEC"

# === KROK 1: Budowanie APK ===
echo "=== [1/5] Budowanie wersji Release APK ==="
cd ~/projekty/zabka/triki_app
/home/kawak/sdk/flutter/bin/flutter build apk --release --no-tree-shake-icons

# === KROK 2: Kopiowanie plików do repozytorium git ===
echo "=== [2/5] Kopiowanie plików do lokalnego repozytorium git ==="
rm -rf ~/projekty/zabka/Triki/triki_app
rsync -av --exclude='build/' --exclude='.dart_tool/' --exclude='.idea/' --exclude='android/.gradle/' --exclude='local.properties' ~/projekty/zabka/triki_app/ ~/projekty/zabka/Triki/triki_app/
cp "$APK_PATH" ~/projekty/zabka/Triki/triki_app.apk

# === KROK 3: Commit i tag ===
echo "=== [3/5] Tworzenie commitu i tagu git ==="
cd ~/projekty/zabka/Triki
git config user.name "Oberon"
git config user.email "oberon@kawak.pl"
git add -A

COMMIT_MSG="Release $TAG: automatyczny deploy ($(date '+%Y-%m-%d %H:%M:%S'))"
git commit -m "$COMMIT_MSG" || echo "Brak zmian do zatwierdzenia, kontynuuję tagowanie..."

# Usuń stary tag lokalnie i zdalnie (jeśli istnieje), potem utwórz nowy
git tag -d "$TAG" 2>/dev/null || true
git push origin ":refs/tags/$TAG" 2>/dev/null || true
git push github ":refs/tags/$TAG" 2>/dev/null || true

git tag -a "$TAG" -m "Release $TAG"

# === KROK 4: Push do Gitea i GitHub ===
echo "=== [4/5] Wypychanie do Gitea i GitHub ==="
git push origin main
git push github main
git push origin "$TAG"
git push github "$TAG"

# === KROK 5: Tworzenie GitHub Release i upload APK ===
echo "=== [5/5] Tworzenie GitHub Release $TAG i upload APK ==="

RELEASE_BODY="### Triki-myszka $TAG\n\nAutomatyczne wydanie z $(date '+%Y-%m-%d %H:%M:%S').\n\n**Zmiany:** Aktualizacja kodu źródłowego i nowa wersja APK."

# Utwórz release
RELEASE_RESPONSE=$(curl -s -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/$GITHUB_REPO/releases \
  -d "{\"tag_name\":\"$TAG\",\"target_commitish\":\"main\",\"name\":\"$TAG\",\"body\":\"$RELEASE_BODY\",\"draft\":false,\"prerelease\":false}")

RELEASE_ID=$(echo "$RELEASE_RESPONSE" | python3 -c "import json,sys; r=json.load(sys.stdin); print(r.get('id',''))" 2>/dev/null)

if [ -z "$RELEASE_ID" ]; then
  echo "BŁĄD: Nie udało się utworzyć release. Odpowiedź:"
  echo "$RELEASE_RESPONSE"
  exit 1
fi

echo "  Utworzono Release ID: $RELEASE_ID"

# Upload APK jako asset
UPLOAD_URL="https://uploads.github.com/repos/$GITHUB_REPO/releases/$RELEASE_ID/assets?name=triki_app.apk"
UPLOAD_RESULT=$(curl -s -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Content-Type: application/vnd.android.package-archive" \
  --data-binary @"$APK_PATH" \
  "$UPLOAD_URL" | python3 -c "import json,sys; r=json.load(sys.stdin); print(r.get('browser_download_url', r.get('message','?')))" 2>/dev/null)

echo "  APK dostępne pod: $UPLOAD_RESULT"
echo "=== Wdrożenie $TAG zakończone sukcesem! 🐾 ==="
