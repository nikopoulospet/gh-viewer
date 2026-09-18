#!/usr/bin/env python3
"""Load the Chrome build into headless Chromium and exercise the panel.

The mirror of tests/smoke.py. Same checks, same fixtures, different browser -
which is the point: it proves the shared source really does run on both, rather
than trusting that `chrome` and `browser` are interchangeable.

  python3 tools/build_chrome.py
  nix shell nixpkgs#chromium nixpkgs#chromedriver -c python3 tests/smoke_chrome.py
"""

import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
BUILD = ROOT / "dist" / "chrome"

sys.path.insert(0, str(HERE))
from smoke import WebDriver, free_port, wait_for  # noqa: E402  (same W3C client)


def unpacked_extension_id(path):
    """Chrome derives an unpacked extension's id from its absolute path.

    sha256 of the path, first 16 bytes, each hex digit mapped 0-f -> a-p. Knowing
    it up front avoids having to scrape chrome://extensions to find the id.
    """
    digest = hashlib.sha256(str(path).encode()).hexdigest()[:32]
    return "".join(chr(ord("a") + int(c, 16)) for c in digest)


CHECKS = []


def check(name):
    def register(fn):
        CHECKS.append((name, fn))
        return fn
    return register


@check("the extension loads and the panel page opens")
def _(d):
    d.go(f"{d.base}/sidebar/panel.html")
    wait_for(d, "document.readyState === 'complete'", "the panel to load")
    title = d.script("return document.title;")
    assert title == "gh-viewer", f"unexpected title: {title!r}"


@check("the compat shim gives Chrome a working browser namespace")
def _(d):
    # Recent Chromium ships its own `browser` object, so lib/compat.js is a
    # fallback for versions that do not rather than the mechanism here. Either
    # way what matters is that `browser` resolves to the same live APIs as
    # `chrome` - identity is not the test, capability is.
    state = d.script("""
        return {
          present: typeof browser === 'object',
          storage: typeof browser?.storage?.local?.get === 'function',
          sameStorage: browser?.storage === chrome?.storage,
          sameRuntime: browser?.runtime?.id === chrome?.runtime?.id,
        };
    """)
    assert state["present"], "no browser namespace at all"
    assert state["storage"], "browser.storage.local.get missing"
    assert state["sameStorage"] and state["sameRuntime"], \
        f"browser does not resolve to Chrome's APIs: {state}"
    missing = d.script(
        "return ['store','auth','api','render','DETAIL_DOC']"
        ".filter(k => !(window.GV && window.GV[k]));")
    assert missing == [], f"missing from GV: {missing}"


@check("chrome.storage works through the alias")
def _(d):
    value = d.script("""
        const done = arguments[arguments.length - 1];
        browser.storage.local.set({ smokeProbe: 42 })
          .then(() => browser.storage.local.get('smokeProbe'))
          .then(r => done(r.smokeProbe));
    """, async_script=True)
    assert value == 42, f"storage round-trip returned {value!r}"


@check("the connect screen renders when signed out")
def _(d):
    wait_for(d, "document.body.textContent.includes('Sign in to GitHub')",
             "the connect screen")


@check("a stubbed query renders rows")
def _(d):
    fixture = json.loads((HERE / "fixtures" / "search.json").read_text())
    d.script("""
        const [fixture] = arguments;
        window.fetch = () => Promise.resolve({
          ok: true, status: 200, json: () => Promise.resolve(fixture),
        });
        return browser.storage.local.set({
          token: 'chrome_smoke',
          queries: [{
            id: 'smoke', name: 'Smoke', document: 'query { x }', variables: {},
            list: 'search.nodes', count: 'search.issueCount',
          }],
        }).then(() => boot());
    """, [fixture])
    count = wait_for(d, "document.querySelectorAll('.row').length", "rendered rows")
    assert count == 3, f"expected 3 rows, got {count}"


@check("chips render with real CSS applied")
def _(d):
    colour = d.script(
        "const c = [...document.querySelectorAll('.chip.label')]"
        ".find(n => n.textContent === 'bug');"
        "return c && getComputedStyle(c).backgroundColor;")
    assert colour == "rgb(215, 58, 74)", f"label colour not applied: {colour!r}"


@check("the options page loads and lists the default query")
def _(d):
    d.script("return browser.storage.local.remove('queries');")
    d.go(f"{d.base}/options/options.html")
    count = wait_for(d, "document.querySelectorAll('.card').length", "query cards")
    assert count == 1, f"expected the single default query, got {count}"


class ChromeDriver(WebDriver):
    def start(self, binary, extension):
        caps = {"capabilities": {"alwaysMatch": {
            "browserName": "chrome",
            "goog:chromeOptions": {
                "binary": binary,
                "args": [
                    "--headless=new",  # the only headless mode that loads extensions
                    "--no-sandbox",
                    "--disable-gpu",
                    "--disable-dev-shm-usage",
                    f"--load-extension={extension}",
                    f"--disable-extensions-except={extension}",
                ],
            },
        }}}
        self.session = self.call("POST", "/session", caps)["sessionId"]

    def script(self, source, args=None, async_script=False):
        endpoint = "/execute/async" if async_script else "/execute/sync"
        return self.call("POST", self.s(endpoint), {"script": source, "args": args or []})


def main():
    if not (BUILD / "manifest.json").exists():
        sys.exit("[x] dist/chrome is missing - run: python3 tools/build_chrome.py")

    binary = shutil.which("chromium") or shutil.which("google-chrome-stable")
    if not binary:
        sys.exit("[x] no chromium binary on PATH")

    port = free_port()
    driver = ChromeDriver(port)
    driver.base = f"chrome-extension://{unpacked_extension_id(BUILD)}"
    print(f"[i] extension id: {driver.base.split('//')[1]}")

    gecko = subprocess.Popen(["chromedriver", f"--port={port}"],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    failures = 0
    try:
        for _ in range(60):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/status", timeout=1)
                break
            except Exception:
                time.sleep(0.2)

        driver.start(binary, BUILD)
        driver.call("POST", driver.s("/timeouts"), {"script": 10000})

        for name, fn in CHECKS:
            try:
                fn(driver)
                print(f"[ok] {name}")
            except Exception as e:
                print(f"[x] {name}\n    {str(e)[:300]}")
                failures += 1
    finally:
        driver.quit()
        gecko.terminate()

    print("\n" + ("chrome smoke passed" if not failures else f"{failures} check(s) failed"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
