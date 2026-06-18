#!/usr/bin/env bash
# deploy.sh — wgrywa gry.kawak.pl na hosting FTP
# Użycie: ./deploy.sh ["commit message"]
# Wymaga: FTP_GRY_USER i FTP_GRY_PASS w środowisku lub ~/.env_gry
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ── Kredentiale ─────────────────────────────────────────────────────────────
if [[ -f ~/.env_gry ]]; then
  source ~/.env_gry
fi
if [[ -z "$FTP_GRY_USER" || -z "$FTP_GRY_PASS" ]]; then
  echo "BŁĄD: ustaw FTP_GRY_USER i FTP_GRY_PASS (lub utwórz ~/.env_gry)"
  exit 1
fi

FTP_HOST="ftp.dm72001.domenomania.eu"

# ── Git commit (opcjonalnie) ─────────────────────────────────────────────────
if [[ -n "$1" ]]; then
  echo "→ git commit: $1"
  git add .
  git commit -m "$1

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>" || true
  git push origin main
fi

# ── Upload przez FTP ─────────────────────────────────────────────────────────
echo "→ upload na $FTP_HOST…"
lftp -u "$FTP_GRY_USER,$FTP_GRY_PASS" "$FTP_HOST" << EOF
set ssl:verify-certificate no
mirror -R --parallel=4 --ignore-time --transfer-all \
  --exclude-glob=data/ \
  --exclude-glob=__pycache__/ \
  --exclude-glob=*.log \
  --exclude-glob=*.pyc \
  --exclude-glob=gryzabka.py \
  --exclude-glob=deploy.sh \
  . /
put .htaccess -o /.htaccess
quit
EOF

# ── Uprawnienia ──────────────────────────────────────────────────────────────
echo "→ chmod pliki…"

# Zbierz katalogi gier dynamicznie
GAME_DIRS=$(ls -d games/*/ 2>/dev/null | sed 's|/$||' | while read d; do echo "$d"; done)

lftp -u "$FTP_GRY_USER,$FTP_GRY_PASS" "$FTP_HOST" << EOF
set ssl:verify-certificate no
chmod 644 index.html
chmod 644 keyboard.html
chmod 644 diag.php
chmod 644 api.php
chmod 644 .htaccess
chmod 644 robots.txt
chmod 644 sitemap.xml
chmod 644 static/triki.js
chmod 644 static/app.js
chmod 644 static/style.css
chmod 644 static/gameutils.js
chmod 644 static/sound.js
chmod 644 static/icon.svg
chmod 644 manifest.json
chmod 644 sw.js
chmod 755 static
chmod 755 games
chmod 644 data/.htaccess
quit
EOF

# Uprawnienia dla wszystkich gier — jeden przebieg find po stronie lftp
lftp -u "$FTP_GRY_USER,$FTP_GRY_PASS" "$FTP_HOST" << 'EOFIX'
set ssl:verify-certificate no
find games -maxdepth 1 -type d -exec chmod 755 {} \;
find games -maxdepth 2 -type f -exec chmod 644 {} \;
quit
EOFIX

echo "✓ gotowe → https://gry.kawak.pl"
