# Developing gh-viewer

User-facing instructions live in [README.md](README.md). This is the side that
only matters if you're building, registering, or packaging the thing.

## Registering the App

A GitHub App is registered **once, by the developer** — it produces a public
`client_id`. Everyone else *installs* that App on their account or org and
signs in to it. Registration is not a per-user step.

```bash
python3 tools/register_app.py            # owned by your user account
python3 tools/register_app.py --org some-test-org
python3 tools/register_app.py --name some-other-name
```

App names are unique across the whole of GitHub, and they collide with account
names as well as other Apps — `gh-viewer` itself is taken by the user account
`@gh-viewer`, which is why the default is `gh-viewer-sidebar`. The name only
identifies the App and its `github.com/apps/<slug>` page; the repo and the
extension are unaffected. To check a candidate before you try it, both of these
should 404:

```bash
curl -o /dev/null -w "%{http_code}\n" https://github.com/SOME-NAME
curl -o /dev/null -w "%{http_code}\n" https://github.com/apps/SOME-NAME
```

The script posts an exact permission manifest to GitHub, so the App comes out
read-only with no `contents` permission rather than depending on getting ~40
dropdowns right by hand. You press *Create GitHub App*; it writes `client_id`
to `app.json` (gitignored) and prints the install URL.

Two switches the manifest API cannot set, both on the App's settings page —
which is **not** the public `github.com/apps/<slug>` page, and lives under the
owning organisation when you registered with `--org`:

```
https://github.com/settings/apps/<slug>                        # user-owned
https://github.com/organizations/<org>/settings/apps/<slug>    # org-owned
```


- **Enable Device Flow** — on. Without it the extension cannot authenticate.
- **Expire user authorization tokens** — **off**. Refreshing an expiring token
  requires a client secret, and a browser extension cannot hold one safely.
  With expiry off, the device flow alone is enough.

The conversion response also contains a client secret and a private key.
`register_app.py` deliberately discards both — gh-viewer is a public client and
must never hold either. Delete or rotate them in the App settings if you want
them gone from GitHub too.

## Authentication design

Device flow with a public `client_id` and no secret anywhere. The panel asks
`github.com/login/device/code` for a user code, polls
`github.com/login/oauth/access_token` until approval, and stores the resulting
user-to-server token in `browser.storage.local`.

`api.github.com` sends `Access-Control-Allow-Origin: *` and permits an
`Authorization` header, so **queries need no host permission at all**. Only the
device-flow endpoints do, which is why the manifest's host permission is
exactly `https://github.com/login/*`.

Under MV3 that permission is **not granted by installing**. Firefox treats
`host_permissions` as optional and lets the user revoke them at any time, and —
the part that actually bites — an update that introduces a new host permission
is not shown to the user at all. So `sidebar/panel.js` asks for it at click
time via `GV.auth.ensureHostAccess()`, which wraps `permissions.request()`.
Two things about that call are load-bearing:

- It runs **before any `await`** in the click handler. The prompt is only
  allowed to open while the user gesture is still live, and awaiting anything
  first — including a `permissions.contains()` check — spends it. No check is
  needed anyway: `request()` resolves true without prompting when the origin is
  already held.
- It gates the *first* request to that origin, not the whole flow. Declining
  leaves the panel on the connect screen with an explanation rather than a
  failed `fetch` in the console.

Firefox grants host permissions at **origin** granularity, so once granted the
pattern reads back from `permissions.getAll()` as `https://github.com/*` — the
`/login/*` path narrows the request, not the grant. The manifest keeps the
narrow form because that is what the install prompt and AMO review show.

A **temporarily** installed add-on — `about:debugging`, and what `tests/smoke.py`
does — has its host permissions granted for it, so you will not see the prompt
during development. The declined path is covered in the jsdom suite instead.

The manifest also asks for the `tabs` WebExtension permission, which is
unrelated to GitHub host access: it lets the click handler in
`sidebar/panel.js` call `browser.tabs.query()` to check whether a link is
already open somewhere before deciding to focus it instead of opening a
duplicate. It grants read access to the URLs of every open tab, which is why
it's called out in the README rather than left as an unexplained manifest
entry.

## Telling "not installed" apart from "installed elsewhere"

A GitHub App is installed on an **account**, not on a user, and only account
admins can see an App's installation page. So a member of an org somebody else
set up has no way to tell an App that is missing from their org from one that is
installed but scoped to other repositories — from the sidebar both are an empty
list, and the two have completely different fixes.

`lib/access.js` answers it from the user's own token, via two REST endpoints
GraphQL does not expose: `/user/installations`, then
`/user/installations/{id}/repositories` for each. The Access tab in the options
page renders that.

It is **not** folded into the diagnostics report. That report is built to be
pasted into an issue, and a list of private repository names is exactly the kind
of thing that should not travel with it by default.

## Why not iframe github.com in the sidebar

GitHub sends `X-Frame-Options: deny` and CSP `frame-ancestors 'none'` to prevent
clickjacking. A sidebar counts as a framed context, so the page renders blank
unless the extension strips those headers with blocking `webRequest` — trading
away a real protection and pulling in third-party-cookie fragility. Querying the
API and rendering the result avoids all of it, and costs one rate-limit point
per refresh out of 5,000/hour.

## Validating queries

A typo in a GraphQL document surfaces as an empty sidebar, so check it directly:

```bash
python3 tools/check_queries.py                    # uses the gh CLI's credentials
python3 tools/check_queries.py --token ghu_...    # a token from the App itself
python3 tools/check_queries.py --file export.json # queries exported from the UI
```

With `gh` this proves the documents are **valid**. Run it with an App token to
also prove the App's permissions are **sufficient** — `gh`'s broader token can't
tell you that, since it can see things the App deliberately cannot.

## Testing

```bash
./run-tests.sh          # static + unit + headless Firefox + headless Chrome
./run-tests.sh fast     # skips the browser layer (~1s)
```

Everything is hermetic — no test touches the GitHub API, and all responses come
from `tests/fixtures/`, which are **synthetic on purpose**: this repo is public,
so fixtures built from real private-repo data would publish it. Node, both
browsers and both drivers are fetched by nix at user level; nothing is installed
globally.

Four layers, each catching what the one below cannot:

- **`tools/check_scripts.py`** — the extension's pages load classic scripts that
  share one global scope, so a top-level `const` of the same name in two files
  is a SyntaxError that silently kills the second file. This shipped once. The
  checker tracks real brace depth, so IIFE-wrapped code is correctly ignored.
- **`tests/unit/`** — jsdom, with `browser.*` mocked and fixtures fed through a
  stubbed `fetch`. Evaluates the real page scripts in one shared window, in
  order, exactly as the browser does. Covers the boot states, rendering,
  drill-down, link interception, partial errors, and token rejection.
- **`tests/smoke.py`** — installs the extension into headless Firefox and drives
  it through geckodriver's HTTP API (no selenium dependency). Proves what jsdom
  cannot: the MV3 manifest is accepted, CSP allows the scripts, `browser.*`
  behaves (including `browser.action`, which replaced `browserAction`), and the
  CSS actually paints.
- **`tests/smoke_chrome.py`** — the same checks against the Chrome build, so the
  claim that one source tree serves both browsers is tested rather than assumed.
  It builds `dist/chrome/` on every run, so it can never pass against a stale
  bundle, and it additionally asserts the things `tools/build_chrome.py` rewrites:
  the service worker registers, `side_panel` replaced `sidebar_action`, and no
  Gecko-only key survived.

Things the browser layers need that are easy to trip over. On Firefox: the
extension's internal UUID is pinned via the `extensions.webextensions.uuids`
pref so its pages have a stable address, and geckodriver must be started with
`--allow-system-access`, because opening a privileged `moz-extension://` page
requires switching to the chrome context. On Chrome: only the *new* headless
mode loads extensions, chromedriver must be pointed at the dev shell's chromium
or it picks up whatever system Chrome it finds (usually the wrong version), and
the extension's id is read back off its service worker target rather than
guessed — which is also what proves the MV3 background registered at all.

## The Chrome port

`extension/` is the single source of truth and is written Firefox-first;
`tools/build_chrome.py` derives `dist/chrome/` from it. The whole tree is copied
wholesale, so anything added to `extension/` later ships to Chrome with no list
here to update, and only the things the two browsers genuinely disagree about
are rewritten:

| Firefox | Chrome | why |
| --- | --- | --- |
| `sidebar_action` | `side_panel` + the `sidePanel` permission | different names for the same idea |
| `background.scripts` | `background.service_worker` | MV3 means a service worker on Chrome |
| `extension/background.js` | `chrome/background.js` | Chrome has no `sidebarAction.toggle()`; the action button is wired up declaratively with `setPanelBehavior` instead |
| `browser_specific_settings` | *removed* | Gecko-only, and Chrome rejects the manifest outright if it is left in |
| `icons/icon.svg` | rasterised PNGs | Chrome refuses to load an extension whose icon is an SVG |

Two things deliberately did *not* become build-time rewrites. Page markup and
library code are shared verbatim: the only source difference the port needed was
`extension/lib/compat.js`, which aliases `chrome` to `browser` and is loaded
first on both pages — it is a no-op in Firefox, where `browser` already exists,
and Chrome's MV3 APIs already return promises, which is the only other thing the
libraries assume. And `dist/` is generated, never committed; the Chrome smoke
test rebuilds it on every run.

## Packaging and distribution

Firefox will not permanently install an unsigned extension, so distribution
means getting it signed by Mozilla. There are two channels, and they are very
different propositions.

**Unlisted** — signed but not published. Automated, usually under a minute, no
human review. You get an `.xpi` to host or send to people; they install it via
*about:addons → gear → Install Add-on From File*. Best for personal machines and
handing to a few friends.

```bash
web-ext sign --source-dir=extension --channel=unlisted \
  --api-key=$AMO_JWT_ISSUER --api-secret=$AMO_JWT_SECRET
```

Credentials come from <https://addons.mozilla.org/developers/addon/api/key/>.

**Listed** — published on addons.mozilla.org, searchable and installable by
anyone, with automatic updates. Goes through review; extensions without a build
step and without remote code are the easy case, which this one is. Slower to
land, far easier for other people to install and keep updated.

Either way the version in `manifest.json` must be unique per upload — AMO
rejects a version it has already seen.

```bash
web-ext build --source-dir=extension   # produce an unsigned zip to inspect
```

### Chrome

Chrome has no counterpart to AMO's unlisted channel. It refuses to install an
extension from anywhere but its own Web Store — a self-hosted `.crx` plus an
update URL only works through enterprise policy, which every recipient would
have to set themselves. So there is nothing to sign, and the distributable is a
plain zip that people load unpacked with Developer mode on.

```bash
python3 tools/build_chrome.py --zip    # dist/gh-viewer-chrome-<version>.zip
```

Two properties worth keeping. The archive is **reproducible** — entries sorted,
timestamps pinned to the start of the zip epoch — so the same commit packages to
a byte-identical file and anyone can check a release against their own build.
And everything sits under **one top-level folder** rather than at the zip root,
so unzipping yields a single directory to point *Load unpacked* at instead of
scattering the extension across the user's Downloads. The packaging step re-opens
what it wrote and fails if a required file or the expected version is missing.

Should this ever move to the Web Store, the listing wants the manifest at the
zip *root*, so the wrapping folder would have to go.

### Cutting a release

Releases are driven by the version in `extension/manifest.json`, never by a tag
typed by hand. To release:

1. Open a PR bumping `"version"` in `extension/manifest.json`.
2. Merge it.

That is the whole ritual. `.github/workflows/release.yml` runs on every push to
`main`; it compares the manifest version against existing tags and does nothing
unless the version is new. When it is new, it runs the full suite (both smoke
tests included), packages the Chrome zip, signs with AMO on the unlisted
channel, tags `v<version>`, and publishes a GitHub Release with the signed
`.xpi` and the Chrome zip attached. Both browsers ship from one version bump;
there is no separate Chrome release to remember.

The Chrome zip is built *before* the AMO signing step on purpose. Packaging is
cheap and fails loudly if the build dropped a file, and a failure there costs
nothing — whereas one after signing costs a version bump.

Two secrets are required: `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`, from
<https://addons.mozilla.org/developers/addon/api/key/>. The workflow checks they
exist before running anything expensive.

Deriving the tag from the manifest means the two can never disagree. The trade
is that merging a version bump publishes immediately — there is no "bumped but
not yet released" state. To add a pause, give the `release` job an
`environment:` with a required reviewer; the run then waits for approval before
the secrets are exposed.

**A version number is spent the moment AMO sees it** and can never be reused. So
the workflow uploads the signed `.xpi` as a workflow artifact *before* creating
the release — if publishing fails afterwards, the signed file is still
recoverable rather than lost to a version that can no longer be rebuilt.

`tools/verify_xpi.py` checks a built archive before it is published: that it is
genuinely signed (Mozilla's signature lands in `META-INF/`), that its version is
the expected one, and that nothing is missing from it.

```bash
python3 tools/verify_xpi.py dist/*.xpi --expect-version 0.2.0
python3 tools/verify_xpi.py /tmp/build.zip --allow-unsigned   # inspect a local build
```

### Who can trigger a release

Anyone with write access, by merging a version bump. Note that **tag protection
is separate from branch protection** — the rules on `main` do not cover
`refs/tags/*`. This matters if collaborators are ever added: guard releases with
a tag ruleset on `refs/tags/v*`, or with the environment approval above.

### Self-hosted updates

An unlisted add-on does not update itself unless you tell it where to look. Add
`browser_specific_settings.gecko.update_url` pointing at a JSON manifest you
host, listing each version and its `.xpi` URL. Without it, every update means
manually sending a new file.

### Compatibility floor

`strict_min_version` is 140 because `data_collection_permissions` — which AMO
now requires — was introduced there. `gecko_android` is declared separately at
142 for the same reason; Firefox for Android has no sidebar, so this is desktop
software regardless.

### Screenshots

`screenshots/` is generated, never hand-captured:

```bash
nix shell nixpkgs#firefox nixpkgs#geckodriver -c python3 tools/screenshots.py
```

It drives the same headless Firefox the smoke test uses, installs the extension,
stubs `fetch`, and photographs the real UI over fabricated data — so no private
repository can ever appear in an image, and the shots stay honest when the UI
changes. Both themes are captured by forcing `ui.systemUsesDarkTheme`.

The images are 380x520 — a realistic sidebar width, and roughly square rather
than the long thin strip a full-height panel produces. Note the generator sizes
the **viewport**, not the window: Firefox enforces a minimum window width of 500
and subtracts its own frame, so asking for a 420px window silently yields a
244px viewport, which wraps every title onto three lines and makes the images
twice as tall as they need to be. The frame overhead is measured and corrected
rather than hard-coded, since it varies by version.

Two ordering constraints are load-bearing, both learned the hard way. Storage is
seeded from the options page *before* the panel opens, because writing `queries`
while the panel is live fires `storage.onChanged` and re-boots it mid-capture.
And the token is withheld until `fetch` is stubbed: with a token present, the
panel's own startup would send it to the real API, and the 401 coming back wipes
the token and replaces the view with the sign-in screen.

### Continuous integration

`.github/workflows/tests.yml` runs on pushes to `main` and on every PR, but does
real work only when something testable changed. Which paths count is a
`paths-filter` block near the top of the file, with one list per job so each
suite names what it actually depends on; add a line to extend it.

The shape matters. **`tests`, `smoke` and `smoke-chrome` are optional and may
be skipped; a single `gate` job is the required check.** That is because a
skipped job never reports a result, and branch protection waits for a required
check forever — so
requiring a path-filtered job makes docs-only PRs permanently unmergeable. The
gate runs with `if: always()`, treats a *skipped* dependency as a pass and a
*failed* one as a failure, and so is the one status guaranteed to arrive.

Branch protection should therefore require exactly one check: **`CI`** (the gate
job's name). Adding the optional jobs back to the required list would reintroduce
the deadlock.

### Linting

`web-ext lint` runs as part of `./run-tests.sh`, so a packaging blocker shows up
on an ordinary test run rather than on the day you try to publish. It must stay
at zero errors *and* zero warnings.

## Layout

```
extension/
  lib/store.js      settings, saved queries, the default query set
  lib/auth.js       device flow
  lib/api.js        GraphQL client, partial-error aware
  lib/render.js     list rows, the drill-down view, and its detail query
  lib/access.js     which installations and repositories the App can read
  lib/compat.js     aliases `chrome` to `browser`; a no-op in Firefox
  sidebar/          the panel
  options/          query editor
chrome/
  background.js     Chrome's service worker, in place of extension/background.js
tools/
  register_app.py   App manifest registration flow
  check_queries.py  validates every shipped GraphQL document
  build_chrome.py   derives dist/chrome/ from extension/
```

Two conventions worth keeping:

- **Nothing from GitHub is ever inserted as HTML.** Titles, labels and comment
  bodies go in with `textContent`; a PR title is untrusted input.
- **GraphQL partial results are normal.** A field the App can't read comes back
  null with an entry in `errors` while everything else resolves, so the client
  surfaces `errors` as a warning rather than treating the response as failed.
