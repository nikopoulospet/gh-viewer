#!/usr/bin/env bash
# Runs every layer of the test suite. Tools (node, python3, firefox,
# geckodriver, chromium, chromedriver) come from the repo's flake dev shell,
# either because you are already inside one (e.g. `nix develop`, or CI) or
# because this script drops you into one itself via ad-hoc `nix shell` calls.
#
#   ./run-tests.sh            static + unit + both browser smokes
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

# Builds dist/chrome itself, so it needs the rasteriser as well as the browser.
run_chrome() {
  if command -v chromium >/dev/null 2>&1 && command -v chromedriver >/dev/null 2>&1 \
     && command -v rsvg-convert >/dev/null 2>&1; then
    python3 tests/smoke_chrome.py
  else
    $NIX shell nixpkgs#chromium nixpkgs#chromedriver nixpkgs#librsvg \
      -c python3 tests/smoke_chrome.py
  fi
}

run_lint() {
  if command -v web-ext >/dev/null 2>&1; then
    web-ext lint --source-dir=extension --output=text
  else
    $NIX shell nixpkgs#web-ext -c web-ext lint --source-dir=extension --output=text
  fi
}

# Mozilla's own validator. Kept in the fast path because a packaging blocker
# should surface on every run, not the day you try to publish.
step "lint: AMO validation (web-ext)"
run_lint | grep -E "^(errors|warnings|notices)" ; track ${PIPESTATUS[0]}

step "static: script collisions"
python3 tools/check_scripts.py; track $?

step "unit: panel behaviour (jsdom)"
run_node 'cd tests && node --test "unit/*.test.mjs"'; track $?

if [ "${1:-}" != "fast" ]; then
  step "smoke: real headless Firefox"
  run_browser; track $?

  step "smoke: real headless Chrome"
  run_chrome; track $?
fi

printf '\n'
if [ "$FAILED" -eq 0 ]; then
  echo "all suites passed"
else
  echo "$FAILED suite(s) failed"
fi
exit $((FAILED > 0))
