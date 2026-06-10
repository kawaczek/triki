#!/bin/bash
# Automatyczny skrypt budowania i wdrażania (Automated Build & Deploy Workflow)
# Uruchamiany na Minionku.
# - Automatycznie inkrementuje wersję patch w pubspec.yaml
# - Tworzy tag git i Release na GitHub ORAZ Gitea z plikiem APK
# - Nazwa pliku APK zawiera wersję: triki-myszka_v1.0.1.apk

set -e

# === Konfiguracja ===
GITHUB_TOKEN_FILE="$HOME/.github_token"
if [ ! -f "$GITHUB_TOKEN_FILE" ]; then
  echo "BŁĄD: Brak pliku tokenu GitHub: $GITHUB_TOKEN_FILE"
  echo "Utwórz go: echo 'TWÓJ_TOKEN' > ~/.github_token && chmod 600 ~/.github_token"
  exit 1
fi
GITHUB_TOKEN=$(cat "$GITHUB_TOKEN_FILE" | tr -d '[:space:]')

GITEA_URL="https://git.kawak.pl"
GITEA_USER="kawak"
GITEA_PASS="kawaK1243"
GITEA_REPO="kawak/Triki"

GITHUB_REPO="kawaczek/triki"
PUBSPEC="$HOME/projekty/zabka/triki_app/pubspec.yaml"
APK_SRC="$HOME/projekty/zabka/triki_app/build/app/outputs/flutter-apk/app-release.apk"

# === KROK 0: Automatyczne podbicie wersji patch ===
echo "=== [0/5] Automatyczne podbijanie wersji ==="
CURRENT_VERSION=$(grep '^version:' "$PUBSPEC" | sed 's/version: //' | tr -d '[:space:]')
VERSION_NAME=$(echo "$CURRENT_VERSION" | cut -d'+' -f1)
BUILD_NUMBER=$(echo "$CURRENT_VERSION" | cut -d'+' -f2)

MAJOR=$(echo "$VERSION_NAME" | cut -d'.' -f1)
MINOR=$(echo "$VERSION_NAME" | cut -d'.' -f2)
PATCH=$(echo "$VERSION_NAME" | cut -d'.' -f3)
NEW_PATCH=$((PATCH + 1))
NEW_BUILD=$((BUILD_NUMBER + 1))
NEW_VERSION_NAME="$MAJOR.$MINOR.$NEW_PATCH"
NEW_FULL_VERSION="$NEW_VERSION_NAME+$NEW_BUILD"
TAG="v$NEW_VERSION_NAME"
APK_NAME="triki-myszka_${TAG}.apk"
APK_DEST="$HOME/projekty/zabka/triki_app/build/app/outputs/flutter-apk/$APK_NAME"

echo "  Stara wersja: $CURRENT_VERSION"
echo "  Nowa wersja:  $NEW_FULL_VERSION (tag: $TAG, plik: $APK_NAME)"

sed -i "s/^version: .*/version: $NEW_FULL_VERSION/" "$PUBSPEC"

# === KROK 1: Budowanie APK ===
echo "=== [1/5] Budowanie wersji Release APK ==="
cd ~/projekty/zabka/triki_app
/home/kawak/sdk/flutter/bin/flutter build apk --release --no-tree-shake-icons

# Skopiuj APK z nazwą wersjonowaną
cp "$APK_SRC" "$APK_DEST"

# === KROK 2: Kopiowanie do repo git ===
echo "=== [2/5] Kopiowanie plików do lokalnego repozytorium git ==="
rm -rf ~/projekty/zabka/Triki/triki_app
rsync -av --exclude='build/' --exclude='.dart_tool/' --exclude='.idea/' --exclude='android/.gradle/' --exclude='local.properties' \
  ~/projekty/zabka/triki_app/ ~/projekty/zabka/Triki/triki_app/
cp "$APK_SRC" ~/projekty/zabka/Triki/triki_app.apk

# === KROK 3: Commit i tag ===
echo "=== [3/5] Tworzenie commitu i tagu git ==="
cd ~/projekty/zabka/Triki
git config user.name "Oberon"
git config user.email "oberon@kawak.pl"
git add -A

git commit -m "Release $TAG: automatyczny deploy ($(date '+%Y-%m-%d %H:%M:%S'))" || echo "Brak zmian, kontynuuję..."

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

# === KROK 5: Gitea Release + upload APK ===
echo "=== [5/5] Tworzenie Release na Gitea i GitHub ==="
RELEASE_BODY="Automatyczne wydanie $TAG z $(date '+%Y-%m-%d %H:%M:%S')."

# --- Gitea ---
GITEA_RELEASE=$(curl -s -X POST \
  -u "$GITEA_USER:$GITEA_PASS" \
  -H "Content-Type: application/json" \
  "$GITEA_URL/api/v1/repos/$GITEA_REPO/releases" \
  -d "{\"tag_name\":\"$TAG\",\"name\":\"Triki-myszka $TAG\",\"body\":\"$RELEASE_BODY\",\"draft\":false,\"prerelease\":false}")

GITEA_RELEASE_ID=$(echo "$GITEA_RELEASE" | python3 -c "import json,sys; r=json.load(sys.stdin); print(r.get('id',''))" 2>/dev/null)

if [ -n "$GITEA_RELEASE_ID" ]; then
  GITEA_UPLOAD=$(curl -s -X POST \
    -u "$GITEA_USER:$GITEA_PASS" \
    -H "Content-Type: application/vnd.android.package-archive" \
    --data-binary @"$APK_DEST" \
    "$GITEA_URL/api/v1/repos/$GITEA_REPO/releases/$GITEA_RELEASE_ID/assets?name=$APK_NAME")
  echo "  Gitea: $GITEA_URL/$GITEA_REPO/releases/tag/$TAG"
else
  echo "  OSTRZEŻENIE: Nie udało się utworzyć release na Gitea."
fi

# --- GitHub ---
GITHUB_RELEASE=$(curl -s -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/$GITHUB_REPO/releases" \
  -d "{\"tag_name\":\"$TAG\",\"target_commitish\":\"main\",\"name\":\"Triki-myszka $TAG\",\"body\":\"$RELEASE_BODY\",\"draft\":false,\"prerelease\":false}")

GITHUB_RELEASE_ID=$(echo "$GITHUB_RELEASE" | python3 -c "import json,sys; r=json.load(sys.stdin); print(r.get('id',''))" 2>/dev/null)

if [ -n "$GITHUB_RELEASE_ID" ]; then
  GITHUB_UPLOAD=$(curl -s -X POST \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Content-Type: application/vnd.android.package-archive" \
    --data-binary @"$APK_DEST" \
    "https://uploads.github.com/repos/$GITHUB_REPO/releases/$GITHUB_RELEASE_ID/assets?name=$APK_NAME" \
    | python3 -c "import json,sys; r=json.load(sys.stdin); print(r.get('browser_download_url','?'))" 2>/dev/null)
  echo "  GitHub: $GITHUB_UPLOAD"
else
  echo "  OSTRZEŻENIE: Nie udało się utworzyć release na GitHub."
fi

echo "=== Wdrożenie $TAG zakończone sukcesem! 🐾 ==="
