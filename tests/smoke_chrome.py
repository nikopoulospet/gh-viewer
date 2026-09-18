#!/usr/bin/env python3
"""Load the Chrome build into a real headless Chromium and exercise the panel.

The Chrome counterpart to tests/smoke.py, and deliberately the same checks: the
whole point of the port is that one source tree behaves the same in both
browsers, so a check that only exists on one side proves nothing. What is extra
here is Chrome-specific - the service worker has to register, and side_panel
has to replace sidebar_action - because those are exactly what the build script
rewrites and nothing else would catch a mistake in it.

The bundle is built fresh on every run, so this can never pass against a stale
dist/. Unlike Firefox, Chrome lets WebDriver navigate straight to a
chrome-extension:// page, so there is no chrome-context detour.

  nix shell nixpkgs#chromium nixpkgs#chromedriver -c python3 tests/smoke_chrome.py
"""

import json
import pathlib
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tools"))
import build_chrome  # noqa: E402


class WebDriver:
    def __init__(self, port):
        self.url = f"http://127.0.0.1:{port}"
        self.session = None
        self.extension_id = None

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

    def start(self, bundle, profile):
        # chromedriver picks whatever Chrome it finds on the system unless the
        # binary is named, and a system Chrome is rarely the version this
        # chromedriver supports. Point it at the one from the dev shell.
        binary = shutil.which("chromium") or shutil.which("google-chrome")
        if not binary:
            sys.exit("chromium is missing - run inside `nix develop`")
        caps = {"capabilities": {"alwaysMatch": {
            "browserName": "chrome",
            "goog:chromeOptions": {
                "binary": binary,
                "args": [
                    "--headless=new",  # the old headless mode loads no extensions
                    "--no-sandbox",    # no user namespaces in most CI containers
                    "--disable-gpu",
                    "--disable-dev-shm-usage",
                    f"--user-data-dir={profile}",
                    f"--load-extension={bundle}",
                    f"--disable-extensions-except={bundle}",
                ],
            },
        }}}
        self.session = self.call("POST", "/session", caps)["sessionId"]

    def s(self, path):
        return f"/session/{self.session}{path}"

    def cdp(self, cmd, params=None):
        return self.call("POST", self.s("/goog/cdp/execute"),
                         {"cmd": cmd, "params": params or {}})

    def await_service_worker(self, timeout=20):
        """Wait for the extension's service worker, and take its id from the URL.

        An unpacked extension's id is derived from its path, but that mapping is
        undocumented. The worker's own URL states the id outright, and waiting
        for it doubles as proof that the MV3 background registered at all -
        the failure a manifest with a Firefox-style `background.scripts` gives.
        """
        deadline = time.time() + timeout
        while time.time() < deadline:
            for target in self.cdp("Target.getTargets").get("targetInfos", []):
                if (target.get("type") == "service_worker"
                        and target.get("url", "").startswith("chrome-extension://")):
                    self.extension_id = target["url"].split("/")[2]
                    return self.extension_id
            time.sleep(0.25)
        raise RuntimeError("the extension's service worker never registered")

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


def open_extension_page(driver, path):
    url = f"chrome-extension://{driver.extension_id}/{path}"
    driver.go(url)
    # A page that selects a tab on load writes location.hash, so the fragment is
    # dropped before comparing or an exact match would never arrive.
    wait_for(
        driver,
        f"location.href.split('#')[0] === {json.dumps(url)}"
        " && document.readyState === 'complete'",
        f"{url} to finish loading",
    )


CHECKS = []


def check(name):
    def register(fn):
        CHECKS.append((name, fn))
        return fn
    return register


@check("the extension installs and the panel page loads")
def _(d):
    open_extension_page(d, "sidebar/panel.html")
    title = d.script("return document.title;")
    assert title == "gh-viewer", f"unexpected title: {title!r}"


@check("every library registers itself in the real browser")
def _(d):
    # Chrome has no `browser` global of its own, so this is also what proves
    # lib/compat.js ran first and aliased it - without that, every one of these
    # libraries throws on load and the panel comes up blank.
    missing = d.script(
        "return ['store','auth','api','render','DETAIL_DOC']"
        ".filter(k => !(window.GV && window.GV[k]));")
    assert missing == [], f"missing from GV: {missing}"


@check("the manifest is accepted as MV3 and the action API exists")
def _(d):
    version = d.script("return browser.runtime.getManifest().manifest_version;")
    assert version == 3, f"expected an MV3 manifest, got {version}"
    ok = d.script("return typeof browser.action?.onClicked?.addListener === 'function';")
    assert ok, "browser.action is not available"


@check("the sidebar is declared the way Chrome expects")
def _(d):
    manifest = d.script("return browser.runtime.getManifest();")
    assert manifest.get("side_panel", {}).get("default_path") == "sidebar/panel.html", \
        f"side_panel: {manifest.get('side_panel')!r}"
    assert "sidebar_action" not in manifest, "the Firefox sidebar_action key survived"
    assert "sidePanel" in manifest["permissions"], \
        f"the sidePanel permission is missing: {manifest['permissions']}"
    ok = d.script("return typeof browser.sidePanel?.setOptions === 'function';")
    assert ok, "browser.sidePanel is not available"


@check("the background is a service worker, not a Firefox event page")
def _(d):
    background = d.script("return browser.runtime.getManifest().background;")
    assert background == {"service_worker": "background.js"}, f"background: {background!r}"


@check("the host permission is declared and visible to permissions.getAll")
def _(d):
    declared = d.script("return browser.runtime.getManifest().host_permissions;")
    assert declared == ["https://github.com/login/*"], f"declared: {declared!r}"
    # Granted at origin granularity, so the /login/* path reads back as the host.
    origins = d.script("return browser.permissions.getAll().then(p => p.origins);")
    assert any(o.startswith("https://github.com/") for o in origins), \
        f"getAll returned {origins!r}"


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


@check("the options page loads and lists the default query")
def _(d):
    open_extension_page(d, "options/options.html")
    count = wait_for(d, "document.querySelectorAll('.card').length", "query cards")
    assert count == 1, f"expected the single default query, got {count}"


def main():
    if not shutil.which("chromedriver"):
        sys.exit("chromedriver is missing - run inside `nix develop`")

    bundle = build_chrome.build(HERE.parent / "dist" / "chrome")
    profile = tempfile.mkdtemp(prefix="gh-viewer-chrome-")

    port = free_port()
    chromedriver = subprocess.Popen(
        ["chromedriver", f"--port={port}"],
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

        driver.start(bundle, profile)
        driver.await_service_worker()

        for name, fn in CHECKS:
            try:
                fn(driver)
                print(f"[ok] {name}")
            except Exception as e:
                print(f"[x] {name}\n    {e}")
                failures += 1
    finally:
        driver.quit()
        chromedriver.terminate()
        shutil.rmtree(profile, ignore_errors=True)

    print("\n" + ("smoke passed" if not failures else f"{failures} check(s) failed"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
