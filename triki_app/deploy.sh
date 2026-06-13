#!/usr/bin/env bash
# deploy.sh — wysyła triki_app/ na minionka i buduje release APK
# Użycie: ./deploy.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "→ rsync triki_app/ → minionek…"
rsync -avz \
  --exclude='build/' \
  --exclude='.dart_tool/' \
  --exclude='.idea/' \
  --exclude='android/.gradle/' \
  --exclude='local.properties' \
  "$SCRIPT_DIR/" minionek:~/projekty/zabka/triki_app/

echo "→ build + release na minionku…"
ssh minionek "bash ~/projekty/zabka/triki_app/deploy_workflow.sh"

echo "✓ gotowe"
