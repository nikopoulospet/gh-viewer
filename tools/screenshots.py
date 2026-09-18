#!/usr/bin/env python3
"""Render README screenshots from the real extension, with fabricated data.

Reuses the smoke-test harness: a real headless Firefox with the extension
installed, its fetch stubbed so every pixel is genuine UI over invented content.
Nothing here touches GitHub, so no private repository can leak into an image.

  nix shell nixpkgs#firefox nixpkgs#geckodriver -c python3 tools/screenshots.py
"""

import base64
import json
import pathlib
import subprocess
import sys
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tests"))
from smoke import WebDriver, free_port, open_extension_page, wait_for, BASE, EXTENSION, EXT_ID, EXT_UUID  # noqa: E402

OUT = ROOT / "screenshots"
WIDTH, HEIGHT = 420, 900

REPO_A, REPO_B = "acme-corp/atlas", "acme-corp/beacon"

LIST = {"data": {"rateLimit": {"remaining": 4983}, "search": {"issueCount": 6, "nodes": [
  {"__typename": "PullRequest", "id": "PR_1", "number": 812,
   "title": "Retry flaky uploads instead of failing the whole batch",
   "url": f"https://github.com/{REPO_A}/pull/812", "isDraft": False, "state": "OPEN",
   "updatedAt": "2026-09-17T09:40:00Z", "reviewDecision": "APPROVED",
   "author": {"login": "rmeyer"}, "repository": {"nameWithOwner": REPO_A},
   "labels": {"nodes": [{"name": "bug", "color": "d73a4a"},
                        {"name": "storage", "color": "0e8a16"}]},
   "comments": {"totalCount": 7}, "statusCheckRollup": {"state": "SUCCESS"}},
  {"__typename": "PullRequest", "id": "PR_2", "number": 809,
   "title": "Fix race in the scheduler shutdown path",
   "url": f"https://github.com/{REPO_A}/pull/809", "isDraft": False, "state": "OPEN",
   "updatedAt": "2026-09-17T08:05:00Z", "reviewDecision": "CHANGES_REQUESTED",
   "author": {"login": "dlin"}, "repository": {"nameWithOwner": REPO_A},
   "labels": {"nodes": [{"name": "bug", "color": "d73a4a"}]},
   "comments": {"totalCount": 12}, "statusCheckRollup": {"state": "FAILURE"}},
  {"__typename": "PullRequest", "id": "PR_3", "number": 144,
   "title": "Add cursor-based pagination to the search endpoint",
   "url": f"https://github.com/{REPO_B}/pull/144", "isDraft": False, "state": "OPEN",
   "updatedAt": "2026-09-16T17:22:00Z", "reviewDecision": "REVIEW_REQUIRED",
   "author": {"login": "you"}, "repository": {"nameWithOwner": REPO_B},
   "labels": {"nodes": [{"name": "enhancement", "color": "a2eeef"},
                        {"name": "needs-review", "color": "fbca04"}]},
   "comments": {"totalCount": 2}, "statusCheckRollup": {"state": "PENDING"}},
  {"__typename": "PullRequest", "id": "PR_4", "number": 141,
   "title": "Split the ingest worker into its own service",
   "url": f"https://github.com/{REPO_B}/pull/141", "isDraft": True, "state": "OPEN",
   "updatedAt": "2026-09-15T11:00:00Z", "reviewDecision": None,
   "author": {"login": "you"}, "repository": {"nameWithOwner": REPO_B},
   "labels": {"nodes": []}, "comments": {"totalCount": 0},
   "statusCheckRollup": {"state": "SUCCESS"}},
  {"__typename": "PullRequest", "id": "PR_5", "number": 803,
   "title": "Document the retention policy for archived batches",
   "url": f"https://github.com/{REPO_A}/pull/803", "isDraft": False, "state": "OPEN",
   "updatedAt": "2026-09-14T14:12:00Z", "reviewDecision": "APPROVED",
   "author": {"login": "you"}, "repository": {"nameWithOwner": REPO_A},
   "labels": {"nodes": [{"name": "docs", "color": "5319e7"}]},
   "comments": {"totalCount": 1}, "statusCheckRollup": {"state": "SUCCESS"}},
  {"__typename": "Issue", "id": "I_6", "number": 798,
   "title": "Timeouts are reported as successes in the nightly run",
   "url": f"https://github.com/{REPO_A}/issues/798", "state": "OPEN",
   "updatedAt": "2026-09-13T10:00:00Z",
   "author": {"login": "rmeyer"}, "repository": {"nameWithOwner": REPO_A},
   "labels": {"nodes": [{"name": "bug", "color": "d73a4a"}]},
   "comments": {"totalCount": 4}},
]}}}

DETAIL = {"data": {"node": {
  "__typename": "PullRequest", "number": 812,
  "title": "Retry flaky uploads instead of failing the whole batch",
  "url": f"https://github.com/{REPO_A}/pull/812",
  "bodyHTML": "<p>Uploads that time out now <strong>retry twice</strong> with backoff "
              "before the batch is failed.</p><h2>Notes</h2><ul>"
              "<li>Backoff is <code>2s, 8s</code>.</li>"
              "<li>Closes <a href=\"/acme-corp/atlas/issues/798\">#798</a>.</li></ul>"
              "<pre><code>retries: 2\nbackoff: exponential\n</code></pre>",
  "state": "OPEN", "isDraft": False, "merged": False,
  "updatedAt": "2026-09-17T09:40:00Z", "createdAt": "2026-09-14T09:00:00Z",
  "reviewDecision": "APPROVED",
  "author": {"login": "rmeyer"}, "repository": {"nameWithOwner": REPO_A},
  "labels": {"nodes": [{"name": "bug", "color": "d73a4a"},
                       {"name": "storage", "color": "0e8a16"}]},
  "assignees": {"nodes": [{"login": "you"}]},
  "reviews": {"nodes": [
    {"author": {"login": "dlin"}, "state": "APPROVED", "submittedAt": "2026-09-17T09:10:00Z"},
    {"author": {"login": "pnorth"}, "state": "APPROVED", "submittedAt": "2026-09-16T16:40:00Z"}]},
  "comments": {"nodes": [
    {"author": {"login": "dlin"}, "createdAt": "2026-09-17T09:05:00Z",
     "bodyHTML": "<p>Does this cover the multipart path too?</p>",
     "url": f"https://github.com/{REPO_A}/pull/812#issuecomment-1"}]},
  "statusCheckRollup": {"state": "FAILURE", "contexts": {"totalCount": 5, "nodes": [
    {"__typename": "CheckRun", "name": "integration", "conclusion": "FAILURE",
     "detailsUrl": f"https://github.com/{REPO_A}/runs/5"},
    {"__typename": "CheckRun", "name": "unit", "conclusion": "SUCCESS",
     "detailsUrl": f"https://github.com/{REPO_A}/runs/1"},
    {"__typename": "CheckRun", "name": "lint", "conclusion": "SUCCESS",
     "detailsUrl": f"https://github.com/{REPO_A}/runs/2"},
    {"__typename": "StatusContext", "context": "coverage/project", "state": "SUCCESS",
     "targetUrl": "https://coverage.example/1"}]}},
}}}

# Storage is seeded from the options page, BEFORE the panel is opened. Writing
# it while the panel is live fires storage.onChanged, which re-boots the panel
# and would replace the very view being photographed.
SEED = """
return browser.storage.local.set({
  viewer: { login: 'you' },
  queries: [{
    id: 'my-prs', name: 'My PRs', document: GV.SEARCH_DOC,
    variables: { q: 'is:pr state:open involves:@me archived:false', first: 30 },
    list: 'search.nodes', count: 'search.issueCount',
  }],
});
"""

STUB = """
const [list, detail] = arguments;
window.fetch = async (url, options) => {
  const body = options && options.body ? JSON.parse(options.body) : {};
  const isDetail = typeof body.query === 'string' && body.query.includes('node(id:');
  return { ok: true, status: 200, json: async () => (isDetail ? detail : list) };
};
// The token is deliberately absent until now. With no token the panel's own
// boot renders the sign-in screen and makes no request at all; had it held the
// demo token it would have sent it to the real API, and the 401 coming back
// would have wiped the token and replaced whatever was on screen.
// Writing `token` is safe here: only a `queries` change triggers a re-boot.
return browser.storage.local.set({ token: 'ghu_demo' }).then(() => boot());
"""


def shoot(driver, name):
    png = driver.call("GET", driver.s("/screenshot"))
    path = OUT / name
    path.write_bytes(base64.b64decode(png))
    print(f"  wrote {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KB)")


def capture(dark):
    port = free_port()
    gecko = subprocess.Popen(["geckodriver", "--port", str(port), "--allow-system-access"],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    driver = WebDriver(port)
    theme = "dark" if dark else "light"
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/status", timeout=1)
                break
            except Exception:
                time.sleep(0.2)

        prefs = {"extensions.webextensions.uuids": json.dumps({EXT_ID: EXT_UUID})}
        if dark:
            # Makes prefers-color-scheme: dark match, so the panel renders its
            # dark palette rather than the light one.
            prefs["ui.systemUsesDarkTheme"] = 1
        caps = {"capabilities": {"alwaysMatch": {
            "browserName": "firefox",
            "moz:firefoxOptions": {"args": ["-headless"], "prefs": prefs},
        }}}
        driver.session = driver.call("POST", "/session", caps)["sessionId"]
        driver.install(EXTENSION)
        driver.call("POST", driver.s("/window/rect"),
                    {"width": WIDTH, "height": HEIGHT, "x": 0, "y": 0})

        # The options page has the same browser.* access and is not the page
        # being photographed, so seeding from there disturbs nothing.
        open_extension_page(driver, f"{BASE}/options/options.html")
        driver.script(SEED)

        open_extension_page(driver, f"{BASE}/sidebar/panel.html")
        driver.script(STUB, [LIST, DETAIL])
        wait_for(driver, "document.querySelectorAll('.row').length >= 6", "the list")
        time.sleep(0.4)
        shoot(driver, f"01-list-{theme}.png")

        # The click can land before the panel has finished wiring up, which
        # simply does nothing rather than failing - so retry until it takes.
        for _ in range(6):
            driver.script("const r = document.querySelector('.row');"
                          "if (r) r.dispatchEvent(new MouseEvent('click', {bubbles: true}));"
                          "return true;")
            time.sleep(0.6)
            if driver.script("return !!document.querySelector('.detail');"):
                break
        else:
            raise AssertionError("the detail view never opened")
        time.sleep(0.4)
        shoot(driver, f"02-detail-{theme}.png")
    finally:
        driver.quit()
        gecko.terminate()


def main():
    OUT.mkdir(exist_ok=True)
    for dark in (False, True):
        print(f"{'dark' if dark else 'light'} theme:")
        capture(dark)
    print(f"\nScreenshots in {OUT}/ - all data is fabricated.")


if __name__ == "__main__":
    main()
