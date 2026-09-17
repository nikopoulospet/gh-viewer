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

Two switches the manifest API cannot set, both on the App's settings page:

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
device-flow endpoints do, which is why the manifest asks for exactly
`storage` and `https://github.com/login/*`.

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

## Packaging

```bash
web-ext sign --source-dir=extension --channel=unlisted
```

Unlisted signing needs AMO API credentials and gets you an installable `.xpi`
without review. Alternatively run Developer Edition / Nightly / ESR with
`xpinstall.signatures.required = false`.

## Layout

```
extension/
  lib/store.js      settings, saved queries, the default query set
  lib/auth.js       device flow
  lib/api.js        GraphQL client, partial-error aware
  lib/render.js     list rows, the drill-down view, and its detail query
  sidebar/          the panel
  options/          query editor
tools/
  register_app.py   App manifest registration flow
  check_queries.py  validates every shipped GraphQL document
```

Two conventions worth keeping:

- **Nothing from GitHub is ever inserted as HTML.** Titles, labels and comment
  bodies go in with `textContent`; a PR title is untrusted input.
- **GraphQL partial results are normal.** A field the App can't read comes back
  null with an entry in `errors` while everything else resolves, so the client
  surfaces `errors` as a warning rather than treating the response as failed.
