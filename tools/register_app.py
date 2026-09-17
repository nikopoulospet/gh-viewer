#!/usr/bin/env python3
"""Register the gh-viewer GitHub App via the manifest flow.

Hand-registering an App means clicking through ~40 permission dropdowns and
getting one wrong. The manifest flow posts the exact permission set to GitHub,
you review it on one screen, and GitHub hands back the client_id.

  python3 tools/register_app.py                  # owned by your user account
  python3 tools/register_app.py --org my-test-org

Only read permissions are ever requested. No code, contents, or write access.
"""

import argparse
import http.server
import json
import os
import secrets
import socket
import sys
import threading
import urllib.request
import webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_FILE = os.path.join(ROOT, "app.json")

# Read-only, and deliberately excludes `contents` - no code, no diffs.
PERMISSIONS = {
    "metadata": "read",            # mandatory for every App; repo names only
    "issues": "read",
    "pull_requests": "read",
    "discussions": "read",
    "checks": "read",              # CI conclusions next to a PR
    "statuses": "read",            # commit status rollup
    "repository_projects": "read",
    "organization_projects": "read",
}

result = {}
done = threading.Event()


def manifest(port, repo_url, name):
    return {
        # App names are unique across all of GitHub and collide with account
        # names too, so "gh-viewer" is unavailable: @gh-viewer is a real user.
        # This only names the App; the repo and extension are unaffected.
        "name": name,
        "url": repo_url,
        "description": "Saved GraphQL views of your GitHub issues, PRs and "
                       "discussions, rendered in the Firefox sidebar. Read-only.",
        "public": True,  # required to install on orgs you do not own
        "redirect_url": f"http://localhost:{port}/callback",
        "callback_urls": [f"http://localhost:{port}/callback"],
        "hook_attributes": {"url": "https://example.com/unused", "active": False},
        "default_permissions": PERMISSIONS,
        "default_events": [],
        # Off deliberately. It would redirect the installer through the OAuth
        # callback to mint a user token, which only helps an app with a server
        # on that callback. gh-viewer authenticates with device flow from the
        # sidebar instead, so the redirect would just strand the installer on a
        # page with an unused ?code= in the URL.
        "request_oauth_on_install": False,
    }


PAGE = """<!doctype html><meta charset=utf-8><title>Registering gh-viewer</title>
<body style="font:14px system-ui;padding:3em;max-width:40em">
<h2>Sending the App manifest to GitHub&hellip;</h2>
<p>Review the permissions on the next screen, then press
<b>Create GitHub App</b>. Every one of them should say <i>Read-only</i>.</p>
<form id=f method=post action="{action}">
  <input type=hidden name=manifest value='{manifest}'>
  <noscript><button>Continue to GitHub</button></noscript>
</form>
<script>document.getElementById('f').submit()</script>
"""

DONE = """<!doctype html><meta charset=utf-8><title>gh-viewer registered</title>
<body style="font:14px system-ui;padding:3em;max-width:40em">
<h2>{heading}</h2><pre style="white-space:pre-wrap">{detail}</pre>
<p>You can close this tab and return to the terminal.</p>
"""


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass  # keep the terminal readable

    def _send(self, body, status=200):
        raw = body.encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path.startswith("/callback"):
            return self.callback()
        self._send(PAGE.format(
            action=self.server.action,
            # single-quoted HTML attribute, so escape single quotes only
            manifest=json.dumps(self.server.manifest).replace("'", "&#39;"),
        ))

    def callback(self):
        from urllib.parse import parse_qs, urlparse
        params = parse_qs(urlparse(self.path).query)
        code = (params.get("code") or [None])[0]
        state = (params.get("state") or [None])[0]

        if state != self.server.state:
            self._send(DONE.format(heading="State mismatch",
                                   detail="Refusing the response. Rerun the script."), 400)
            result["error"] = "state mismatch"
            done.set()
            return
        if not code:
            self._send(DONE.format(heading="No code returned",
                                   detail="Registration was cancelled."), 400)
            result["error"] = "cancelled"
            done.set()
            return

        req = urllib.request.Request(
            f"https://api.github.com/app-manifests/{code}/conversions",
            method="POST",
            headers={"Accept": "application/vnd.github+json", "User-Agent": "gh-viewer"},
        )
        try:
            with urllib.request.urlopen(req) as r:
                app = json.loads(r.read())
        except Exception as e:
            self._send(DONE.format(heading="Conversion failed", detail=str(e)), 500)
            result["error"] = str(e)
            done.set()
            return

        result["app"] = app
        self._send(DONE.format(
            heading="gh-viewer registered",
            detail=f"App: {app['name']}\nClient ID: {app['client_id']}"))
        done.set()


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--org", help="register the App under this org instead of your user")
    ap.add_argument("--name", default="gh-viewer-sidebar",
                    help="App name; must be unused across all of GitHub "
                         "(default: %(default)s)")
    ap.add_argument("--repo-url", default="https://github.com/nikopoulospet/gh-viewer")
    ap.add_argument("--no-browser", action="store_true",
                    help="print the URL instead of opening a browser")
    args = ap.parse_args()

    port = free_port()
    state = secrets.token_urlsafe(16)
    action = (f"https://github.com/organizations/{args.org}/settings/apps/new?state={state}"
              if args.org else f"https://github.com/settings/apps/new?state={state}")

    server = http.server.HTTPServer(("127.0.0.1", port), Handler)
    server.manifest = manifest(port, args.repo_url, args.name)
    server.action = action
    server.state = state

    print(f"Registering App: {args.name}", flush=True)
    print("Requesting these permissions (all read-only):", flush=True)
    for k, v in PERMISSIONS.items():
        print(f"    {k:<24} {v}", flush=True)
    print(f"\nOpen this to continue:\n\n    http://localhost:{port}/\n", flush=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    if not args.no_browser:
        try:
            webbrowser.open(f"http://localhost:{port}/")
        except Exception:
            pass

    if not done.wait(timeout=600):
        sys.exit("[x] timed out after 10 minutes")
    server.shutdown()

    if "error" in result:
        sys.exit(f"[x] {result['error']}")

    app = result["app"]
    # The conversion also returns a client_secret and a private key. gh-viewer
    # is a public client and must never hold either, so they are dropped here.
    # They still exist on GitHub; delete or rotate them in the App settings.
    with open(APP_FILE, "w") as f:
        json.dump({"client_id": app["client_id"], "slug": app["slug"],
                   "name": app["name"], "html_url": app["html_url"]}, f, indent=2)

    print(f"\n[ok] registered: {app['html_url']}")
    print(f"[ok] client_id saved to {APP_FILE} (gitignored)")
    print(f"""
Two toggles the manifest API cannot set. Open:

    {app['html_url']}

  1. [x] Enable Device Flow
         Without it the extension cannot authenticate at all.
  2. [ ] Expire user authorization tokens  <- UNCHECK this
         Refreshing an expiring token requires a client secret, which a
         browser extension cannot hold. Unchecked, the device flow alone
         is enough and you never re-authenticate.

Then install it on an account or org:

    {app['html_url'].replace('/settings/apps/', '/apps/')}/installations/new

A client secret and private key were generated by GitHub and deliberately
discarded here. Delete them in the App settings if you want them gone.
""")


if __name__ == "__main__":
    main()
