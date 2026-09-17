# gh-viewer

A Firefox sidebar that renders **saved GraphQL queries** against GitHub — your
open PRs, reviews waiting on you, issues, discussions — as a compact list you
can drill into. Every link opens in a new tab; the sidebar never navigates away.

Read-only by construction: the GitHub App requests no `contents` permission, so
it cannot read code or diffs.

## Why not just iframe the GitHub page

GitHub sends `X-Frame-Options: deny` and CSP `frame-ancestors 'none'` to prevent
clickjacking, so a sidebar cannot frame it without stripping security headers.
Querying the API and rendering the result avoids the problem entirely — and one
search costs a single rate-limit point out of 5,000/hour.

## Setup

**1. Register the App** (once):

```bash
python3 tools/register_app.py            # or --org your-test-org
```

It posts an exact permission manifest to GitHub, you press *Create GitHub App*,
and it writes the `client_id` to `app.json` (gitignored). Then set two toggles
it prints, which the manifest API cannot set:

- **Enable Device Flow** — on. Without it the extension cannot authenticate.
- **Expire user authorization tokens** — **off**. Refreshing an expiring token
  requires a client secret, which a browser extension cannot safely hold.
  With expiry off, the device flow alone is enough and you never reconnect.

**2. Install the App** on an account or org from the URL the script prints,
choosing which repositories it may read.

**3. Load the extension:** `about:debugging#/runtime/this-firefox` →
*Load Temporary Add-on* → `extension/manifest.json`. For a permanent install,
sign it (`web-ext sign --source-dir=extension --channel=unlisted`).

**4. Connect:** open the sidebar, paste the Client ID, press *Connect*, and
approve the one-time code GitHub shows you.

## Defining queries

The gear icon opens the query editor. A query is:

| Field | Meaning |
| --- | --- |
| `document` | Any GraphQL document the App's permissions allow |
| `variables` | JSON passed alongside it — usually a search `q` string |
| `list` | Dot path to the array to render, e.g. `search.nodes` |
| `count` | Optional dot path for the status line, e.g. `search.issueCount` |

Rows drill down by node `id`, so keep `id` in the selection set. To scope a
query to one repo, put it in the search string:

```
repo:some-org/some-repo is:pr state:open assignee:@me
```

Validate queries before wondering why the sidebar is empty:

```bash
python3 tools/check_queries.py                 # documents are valid
python3 tools/check_queries.py --token ghu_... # App permissions suffice too
```

## Permissions

| Permission | Why |
| --- | --- |
| `metadata: read` | Mandatory for every GitHub App; repository names only |
| `issues`, `pull_requests`, `discussions: read` | The things being listed |
| `checks`, `statuses: read` | CI state beside each PR |
| `repository_projects`, `organization_projects: read` | Project board fields |

No `contents`, and nothing writable. One caveat worth knowing: GitHub's
`pull_requests: read` is its narrowest PR permission and technically exposes PR
diffs through the files field. gh-viewer never requests or renders them, but
that is a property of GitHub's permission model, not something this App can
narrow further.

The extension itself asks Firefox for only `storage` and
`https://github.com/login/*` — `api.github.com` sends permissive CORS headers,
so querying it needs no host permission at all.

## Layout

```
extension/
  lib/store.js      settings, saved queries, default query set
  lib/auth.js       device flow (public client_id only, no secret)
  lib/api.js        GraphQL client, partial-error aware
  lib/render.js     list rows and the drill-down view
  sidebar/          the panel
  options/          query editor
tools/
  register_app.py   App manifest registration flow
  check_queries.py  validates every shipped GraphQL document
```
