#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "→ git push…"
git push origin main

echo "→ rsync → malina…"
rsync -avz --exclude='data/' --exclude='__pycache__/' --exclude='*.log' gry/ malina:/home/kawak/gry/

echo "✓ gotowe"
