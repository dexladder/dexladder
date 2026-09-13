#!/bin/bash
# One command: typed core → bundle → payload → worker lock. Safe to run repeatedly.
set -euo pipefail
WEB="$(cd "$(dirname "$0")/.." && pwd)"
cd "$WEB"
if [ -x app/node_modules/.bin/esbuild ]; then
  (cd app && node tools/bundle.mjs)
else
  echo "note: app/node_modules missing — using the committed layers/01-app.js + buildlib/generated/dlapp.css (run: cd web/app && npm ci)"
fi
DL_MINT=1 python3 build154.py | grep -E "^arch|^perps|worker|built"
