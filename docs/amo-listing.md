# AMO listing copy

Paste-ready text for submitting gh-viewer to addons.mozilla.org as a **listed**
add-on. Nothing here is used by the extension at runtime; it exists so the
listing is written once and kept under version control rather than retyped into
a web form.

Submit at <https://addons.mozilla.org/developers/addon/submit/distribution> and
choose **"On this site"**.

---

## Name

```
gh-viewer
```

## Summary

Shown under the name in search results. AMO caps this at 250 characters.

```
A sidebar for your GitHub work. Track pull requests, check your backlog and spot
mentions without leaving the page you are on. Define your own views with GitHub
search; read-only, and it never sees your code.
```

## Description

```
gh-viewer puts the GitHub work that matters to you in the Firefox sidebar, so
checking on a review or a backlog does not cost you the tab you were reading.

WHAT IT DOES

- Lists pull requests, issues and discussions as compact rows: title, repository,
  review state, CI status and labels at a glance.
- Click a row to drill in: the checks that ran, who has reviewed, the description
  rendered as markdown, and the latest comments.
- Click any link and it opens in a tab, switching to one you already have open on
  that page rather than piling up duplicates. The sidebar stays where it was.
- Follows your Firefox theme, light or dark.

YOU DEFINE THE VIEWS

Every view is a GitHub search you save once. The shipped one shows everything
involving you, but you can save as many as you like - a team's review queue, your
sprint backlog, bugs filed this week, PRs whose CI is failing - by writing the
same search syntax you would type into GitHub.

WHAT IT CAN SEE

gh-viewer authenticates through a GitHub App that requests read-only access to
issues, pull requests, discussions, checks and projects. It cannot write
anything: no comments, no merges, no label changes. It does not request the
contents permission, so it cannot read your source code.

Your keys are stored locally by Firefox and shared only with GitHub. There is no
server behind this extension - it talks to api.github.com and nowhere else.

OPEN SOURCE

MIT licensed. Source, issues and releases:
https://github.com/nikopoulospet/gh-viewer
```

## Category

**Web Development** (extensions → developer-facing tooling).

## Tags

```
github, pull-requests, sidebar, code-review, developer-tools
```

## Support

- Support site: `https://github.com/nikopoulospet/gh-viewer`
- Support email: whichever address you want public — AMO shows it.

## License

MIT, matching `LICENSE` in the repository.

## Screenshots

Use `screenshots/store/` — the same images as the README, rendered at 2x
(760x1040) so they stay sharp where AMO displays them large:

| File | Caption |
| --- | --- |
| `01-list-light.png` | Your saved views, listing pull requests with review and CI state |
| `02-detail-light.png` | Drilling into a pull request: checks, reviews and the description |
| `01-list-dark.png` | The same list following a dark Firefox theme |
| `02-detail-dark.png` | The drill-in view in dark |

Regenerate with:

```bash
nix shell nixpkgs#firefox nixpkgs#geckodriver -c \
  python3 tools/screenshots.py --scale 2 --out screenshots/store
```

## Notes for the reviewer

Worth stating in the submission notes, since each one is a question a reviewer
would otherwise have to ask:

- **No build step and no minification.** What is in the repository is what is in
  the package, so no source-code submission is required.
- **No remote code.** Everything executes from the packaged files. The only
  network traffic is to `api.github.com`, plus `github.com/login/*` for the
  OAuth device flow.
- **The `tabs` permission** is used solely to find a tab already open at a URL
  before opening a new one, so clicking a link does not create duplicates. It is
  never used to read or record browsing.
- **The client ID in the source is public by design.** gh-viewer authenticates
  with the GitHub App device flow, which is built for clients that cannot keep a
  secret; there is no client secret anywhere in the package.
- **Data collection: none**, as declared in
  `browser_specific_settings.gecko.data_collection_permissions`. The access
  token is stored with `browser.storage.local` and sent only to GitHub.
