#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

MSG="${1:-update}"

if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  echo "→ git add + commit…"
  git add -A
  git commit -m "$MSG"
fi

echo "→ git push…"
git push origin main

echo "✓ gotowe"
