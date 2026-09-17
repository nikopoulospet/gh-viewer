#!/usr/bin/env bash
# Runs every layer of the test suite. Tools come from nix at user level, so
# nothing needs to be installed system-wide.
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

step "static: script collisions"
python3 tools/check_scripts.py; track $?

step "unit: panel behaviour (jsdom)"
$NIX shell nixpkgs#nodejs -c sh -c 'cd tests && node --test "unit/*.test.mjs"'; track $?

if [ "${1:-}" != "fast" ]; then
  step "smoke: real headless Firefox"
  $NIX shell nixpkgs#firefox nixpkgs#geckodriver -c python3 tests/smoke.py; track $?
fi

printf '\n'
if [ "$FAILED" -eq 0 ]; then
  echo "all suites passed"
else
  echo "$FAILED suite(s) failed"
fi
exit $((FAILED > 0))
