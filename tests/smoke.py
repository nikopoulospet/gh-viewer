#!/usr/bin/env python3
"""Load the extension into a real headless Firefox and exercise the panel.

The jsdom suite covers logic; this covers the things only a browser can prove -
that the manifest is accepted, the page's CSP allows the scripts, and the real
browser.* APIs behave. It talks to geckodriver's HTTP API directly so there is
no selenium dependency.

The sidebar panel is an ordinary extension page, so it can be opened as a tab
at a known moz-extension:// URL. The UUID is normally random per profile, so it
is pinned through a pref to make that URL predictable.

  nix shell nixpkgs#firefox nixpkgs#geckodriver -c python3 tests/smoke.py
"""

import json
import pathlib
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
EXTENSION = HERE.parent / "extension"
EXT_ID = "gh-viewer@nikopoulospet.github.io"
EXT_UUID = "8f7e6d5c-4b3a-2910-8f7e-6d5c4b3a2910"
BASE = f"moz-extension://{EXT_UUID}"


class WebDriver:
    def __init__(self, port):
        self.url = f"http://127.0.0.1:{port}"
        self.session = None

    def call(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            f"{self.url}{path}", data=data, method=method,
            headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read() or b"{}").get("value")
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{method} {path}: {e.read().decode()[:400]}") from None

    def start(self):
        caps = {"capabilities": {"alwaysMatch": {
            "browserName": "firefox",
            "moz:firefoxOptions": {
                "args": ["-headless"],
                "prefs": {
                    # Pin the extension's internal UUID so its pages have a
                    # stable address across runs.
                    "extensions.webextensions.uuids": json.dumps({EXT_ID: EXT_UUID}),
                },
            },
        }}}
        self.session = self.call("POST", "/session", caps)["sessionId"]

    def s(self, path):
        return f"/session/{self.session}{path}"

    def install(self, directory):
        return self.call("POST", self.s("/moz/addon/install"),
                         {"path": str(directory), "temporary": True})

    def go(self, url):
        self.call("POST", self.s("/url"), {"url": url})

    def script(self, source, args=None):
        return self.call("POST", self.s("/execute/sync"),
                         {"script": source, "args": args or []})

    def quit(self):
        if self.session:
            try:
                self.call("DELETE", self.s(""))
            except Exception:
                pass


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_for(driver, expression, what, timeout=10):
    """Poll a JS expression until it is truthy - the UI renders asynchronously."""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = driver.script(f"return ({expression});")
        if last:
            return last
        time.sleep(0.2)
    raise AssertionError(f"timed out waiting for {what} (last value: {last!r})")


def open_extension_page(driver, url):
    """Open a moz-extension:// page and focus it.

    WebDriver refuses to navigate a content tab to a privileged URL
    ("Navigation is not allowed in this context"), so the tab is opened from
    the chrome context with the system principal instead, then selected.
    """
    driver.call("POST", driver.s("/moz/context"), {"context": "chrome"})
    try:
        driver.script("""
            const [target] = arguments;
            const tab = gBrowser.addTab(target, {
              triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
            });
            gBrowser.selectedTab = tab;
            return true;
        """, [url])
    finally:
        driver.call("POST", driver.s("/moz/context"), {"context": "content"})

    handles = driver.call("GET", driver.s("/window/handles"))
    driver.call("POST", driver.s("/window"), {"handle": handles[-1]})
    wait_for(driver, "document.readyState === 'complete'", f"{url} to finish loading")


CHECKS = []


def check(name):
    def register(fn):
        CHECKS.append((name, fn))
        return fn
    return register


@check("the extension installs and the panel page loads")
def _(d):
    open_extension_page(d, f"{BASE}/sidebar/panel.html")
    title = d.script("return document.title;")
    assert title == "gh-viewer", f"unexpected title: {title!r}"


@check("every library registers itself in the real browser")
def _(d):
    # The exact failure that shipped: a top-level `const GV` in two classic
    # scripts is a redeclaration SyntaxError, and every later script dies.
    missing = d.script(
        "return ['store','auth','api','render','DETAIL_DOC']"
        ".filter(k => !(window.GV && window.GV[k]));")
    assert missing == [], f"missing from GV: {missing}"


@check("the connect screen renders when signed out")
def _(d):
    wait_for(d, "document.body.textContent.includes('Sign in to GitHub')",
             "the connect screen")


@check("a stubbed query renders rows")
def _(d):
    fixture = json.loads((HERE / "fixtures" / "search.json").read_text())
    d.script(
        """
        const [fixture] = arguments;
        window.fetch = () => Promise.resolve({
          ok: true, status: 200, json: () => Promise.resolve(fixture),
        });
        return browser.storage.local.set({ token: 'ghu_smoke' }).then(() => boot());
        """,
        [fixture],
    )
    count = wait_for(d, "document.querySelectorAll('.row').length", "rendered rows")
    assert count == 3, f"expected 3 rows, got {count}"
    title = d.script("return document.querySelector('.row .title').textContent;")
    assert "Retry flaky uploads" in title, title


@check("chips render with real CSS applied")
def _(d):
    # jsdom does not do layout or stylesheets; this proves panel.css loaded and
    # the label colour is actually painted.
    colour = d.script(
        "const c = [...document.querySelectorAll('.chip.label')]"
        ".find(n => n.textContent === 'bug');"
        "return c && getComputedStyle(c).backgroundColor;")
    assert colour == "rgb(215, 58, 74)", f"label colour not applied: {colour!r}"


@check("the options page loads and lists the default queries")
def _(d):
    open_extension_page(d, f"{BASE}/options/options.html")
    count = wait_for(d, "document.querySelectorAll('.card').length", "query cards")
    assert count >= 4, f"expected the 4 default queries, got {count}"


def main():
    port = free_port()
    # --allow-system-access permits switching to the chrome context, which is
    # the only way to open a privileged moz-extension:// page from WebDriver.
    # It is a geckodriver flag; it cannot be passed through capabilities.
    gecko = subprocess.Popen(
        ["geckodriver", "--port", str(port), "--allow-system-access"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    driver = WebDriver(port)
    failures = 0
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/status", timeout=1)
                break
            except Exception:
                time.sleep(0.2)

        driver.start()
        driver.install(EXTENSION)

        for name, fn in CHECKS:
            try:
                fn(driver)
                print(f"[ok] {name}")
            except Exception as e:
                print(f"[x] {name}\n    {e}")
                failures += 1
    finally:
        driver.quit()
        gecko.terminate()

    print("\n" + ("smoke passed" if not failures else f"{failures} check(s) failed"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
