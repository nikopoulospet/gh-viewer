#!/usr/bin/env bash
# Runs every layer of the test suite. Tools (node, python3, firefox,
# geckodriver) come from the repo's flake dev shell, either because you are
# already inside one (e.g. `nix develop`, or CI) or because this script drops
# you into one itself via ad-hoc `nix shell` calls.
#
#   ./run-tests.sh            static + unit + browser smoke
#   ./run-tests.sh fast       static + unit only (no browser, ~1s)
#
# Tests never touch the GitHub API: all responses come from tests/fixtures.
# The exception is tools/check_queries.py, which is a separate live check.
set -uo pipefail
cd "$(dirname "$0")"

NIX="nix --extra-experimental-features nix-command --extra-experimental-features flakes"
FAILED=0

step() { printf '\n=== %s ===\n' "$1"; }
track() { [ "$1" -eq 0 ] || FAILED=$((FAILED + 1)); }

# When run inside `nix develop` (or CI, which does the same), node/firefox/
# geckodriver are already on PATH - re-entering nix would just re-fetch the
# same packages into a nested shell. Only shell out to nix when a tool is
# actually missing, so this script behaves the same bare or wrapped.
run_node() {
  if command -v node >/dev/null 2>&1; then
    sh -c "$1"
  else
    $NIX shell nixpkgs#nodejs -c sh -c "$1"
  fi
}

run_browser() {
  if command -v firefox >/dev/null 2>&1 && command -v geckodriver >/dev/null 2>&1; then
    python3 tests/smoke.py
  else
    $NIX shell nixpkgs#firefox nixpkgs#geckodriver -c python3 tests/smoke.py
  fi
}

step "static: script collisions"
python3 tools/check_scripts.py; track $?

step "unit: panel behaviour (jsdom)"
run_node 'cd tests && node --test "unit/*.test.mjs"'; track $?

if [ "${1:-}" != "fast" ]; then
  step "smoke: real headless Firefox"
  run_browser; track $?
fi

printf '\n'
if [ "$FAILED" -eq 0 ]; then
  echo "all suites passed"
else
  echo "$FAILED suite(s) failed"
fi
exit $((FAILED > 0))
