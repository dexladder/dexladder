#!/bin/bash
# Runs every gate SEQUENTIALLY against one payload and prints one summary line per gate.
# Sequential on purpose: two gate-e assertions flip under parallel CPU load on identical bytes.
#   bash test/run-all.sh [dist/index.html] [outdir]
WEB="$(cd "$(dirname "$0")/.." && pwd)"; cd "$WEB"
F="${1:-dist/index.html}"; OUT="${2:-/tmp/dl-gates}"; mkdir -p "$OUT"
# Gate a SNAPSHOT: a rebuild while the gates run must not change the bytes under test.
SNAP="$OUT/payload"; rm -rf "$SNAP"; cp -R "$(dirname "$F")" "$SNAP"; F="$SNAP/$(basename "$F")"
echo "payload sha256 $(shasum -a 256 "$F" 2>/dev/null | cut -c1-16 || sha256sum "$F" | cut -c1-16)" > "$OUT/payload.txt"
export LANG=en_US.UTF-8
fail=0
if [ -x app/node_modules/.bin/tsc ]; then
  (cd app && npx tsc -p tsconfig.json --noEmit > "$OUT/typecheck.txt" 2>&1 && node tools/test.mjs > "$OUT/unit.txt" 2>&1 && node tools/bundle.mjs --verify > "$OUT/bundle.txt" 2>&1); r=$?
  printf '%-22s %s\n' app "$( [ $r = 0 ] && echo "typecheck ✓ · $(grep -E '^ℹ pass' "$OUT/unit.txt") · bundle fresh ✓" || echo "FAILED (see $OUT)")"; [ $r = 0 ] || fail=1
fi
[ -f test/gate-arch.js ] && { node test/gate-arch.js > "$OUT/gate-arch.txt" 2>&1; r=$?; printf '%-22s %s\n' gate-arch "$(tail -n 1 "$OUT/gate-arch.txt")"; [ $r = 0 ] || fail=1; }
[ -f test/gate-desks.js ] && { node test/gate-desks.js "$F" > "$OUT/gate-desks.txt" 2>&1; r=$?; printf '%-22s %s (exit %s)\n' gate-desks "$(tail -n 1 "$OUT/gate-desks.txt")" "$r"; [ $r = 0 ] || fail=1; }
[ -f test/gate-bots.js ] && { node test/gate-bots.js "$F" > "$OUT/gate-bots.txt" 2>&1; r=$?; printf '%-22s %s (exit %s)\n' gate-bots "$(tail -n 1 "$OUT/gate-bots.txt")" "$r"; [ $r = 0 ] || fail=1; }
[ -f test/gate-cmc.js ] && { node test/gate-cmc.js "$F" > "$OUT/gate-cmc.txt" 2>&1; r=$?; printf '%-22s %s (exit %s)\n' gate-cmc "$(tail -n 1 "$OUT/gate-cmc.txt")" "$r"; [ $r = 0 ] || fail=1; }
[ -f test/gate-defi.js ] && { node test/gate-defi.js "$F" > "$OUT/gate-defi.txt" 2>&1; r=$?; printf '%-22s %s (exit %s)\n' gate-defi "$(tail -n 1 "$OUT/gate-defi.txt")" "$r"; [ $r = 0 ] || fail=1; }
[ -f test/gate-news-api.js ] && { node test/gate-news-api.js > "$OUT/gate-news-api.txt" 2>&1; r=$?; printf '%-22s %s (exit %s)\n' gate-news-api "$(tail -n 1 "$OUT/gate-news-api.txt")" "$r"; [ $r = 0 ] || fail=1; }
for g in gate154 gate155 gate-fork gate-contrast gate-e gate-render-contrast gate-rhythm gate-voice; do
  node "test/$g.js" "$F" > "$OUT/$g.txt" 2>&1; r=$?
  printf '%-22s %s (exit %s)\n' "$g" "$(grep -E 'passed|failed' "$OUT/$g.txt" | tail -n 1 | sed 's/^ *//')" "$r"
  [ $r = 0 ] || fail=1
done
exit $fail
