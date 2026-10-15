#!/usr/bin/env bash
# Validate every workflow with a fixed upstream actionlint release and checksum.
set -euo pipefail
version=1.7.12
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) platform=linux_amd64; expected=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8 ;;
  Darwin-arm64) platform=darwin_arm64; expected=aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f ;;
  *) echo 'Unsupported actionlint platform' >&2; exit 2 ;;
esac
lint_tmp=$(mktemp -d)
trap 'rm -rf "$lint_tmp"' EXIT
archive="actionlint_${version}_${platform}.tar.gz"
curl --fail --silent --show-error --location --retry 3 --connect-timeout 10 --max-time 120 \
  "https://github.com/rhysd/actionlint/releases/download/v${version}/${archive}" -o "$lint_tmp/$archive"
actual=$(python3 - "$lint_tmp/$archive" <<'PY'
import hashlib, pathlib, sys
print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())
PY
)
test "$actual" = "$expected" || { echo 'actionlint checksum mismatch' >&2; exit 1; }
tar -xzf "$lint_tmp/$archive" -C "$lint_tmp" actionlint
# Do not depend on an optional host shellcheck installation; validate YAML,
# duplicate keys, Actions expressions, jobs and dependencies identically on both hosts.
"$lint_tmp/actionlint" -shellcheck= "$@"
