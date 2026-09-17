# gh-viewer

A Firefox sidebar for the GitHub work that's actually yours — open PRs, reviews
waiting on you, issues, discussions — sitting beside whatever else you're doing
instead of in a tab you keep losing.

You pick what it shows. Each view is a GitHub search you save once, and the
sidebar renders the results as a compact list: title, repo, review state, CI
status, labels. Click a row to see the detail — checks, reviews, latest
comments — without leaving the sidebar. Click any link and it opens in a new
tab, so the list stays exactly where it was.

It can only read, and only issues, pull requests and discussions. It has no
access to your code.

## Install

**1. Add it to Firefox.** Open `about:debugging#/runtime/this-firefox`, choose
*Load Temporary Add-on*, and pick `extension/manifest.json` from this repo.
Firefox removes temporary add-ons when it restarts; for a permanent install use
a signed build (see [DEVELOPING.md](DEVELOPING.md)).

**2. Give it access to your GitHub.** Open
[the gh-viewer App page](https://github.com/apps/gh-viewer-sidebar/installations/new),
press *Install*, and choose which account or organisation it may read — and within
that, all repositories or a hand-picked few. You can change or revoke this at
any time in GitHub's *Settings → Applications*.

> Installing on an organisation you don't own sends a request to an owner
> instead. They approve it once, and it covers everyone in the org.

**3. Sign in.** Open the sidebar (View → Sidebar → gh-viewer, or the toolbar
button). Press **Connect**. GitHub shows you a short code, you approve it in the
tab that opens, and that's it — you won't be asked again.

## Using it

The dropdown at the top switches between your saved views. **↻** refreshes.
**⚙** opens the editor where you add and change views.

- **Click a row** to drill into it — checks with their pass/fail state, who has
  reviewed, and the most recent comments.
- **Click the ↗ on a row**, or any link anywhere, to open it in a new tab.
  Middle-click or Ctrl-click opens it in the background instead.
- **←** takes you back to the list.

The bar along the bottom tells you how many results came back and how much of
your GitHub API budget is left. You have 5,000 points an hour and each refresh
costs one, so it's not something you'll run into.

## Making your own views

gh-viewer starts with four views — your open PRs, PRs awaiting your review,
your open issues, and recent discussions. They're just starting points; edit or
delete any of them in **⚙**.

The part you'll change most is the **search string**, which is exactly what you
would type into GitHub's own search box:

| To see | Search |
| --- | --- |
| Your open PRs in one repo | `repo:some-org/some-repo is:pr state:open assignee:@me` |
| Everything awaiting your review | `is:pr state:open review-requested:@me` |
| Your team's review queue | `is:pr state:open team-review-requested:some-org/some-team` |
| Bugs filed across an org | `org:some-org is:issue state:open label:bug` |
| PRs you opened that aren't drafts | `is:pr state:open author:@me draft:false` |
| Stale PRs | `is:pr state:open assignee:@me updated:<2026-08-01` |

`@me` always means you, so a view keeps working if someone else uses it.

Each view also has a **GraphQL document** — the actual query sent to GitHub.
The default one fetches the fields the list needs, and most of the time you can
leave it alone. If you do write your own, two things matter: keep `id` in the
fields you select (that's what drilling down uses), and point **list path** at
the array you want rendered, e.g. `search.nodes`.

## What it can see

When you install the App, GitHub asks it to read these, and nothing else:

- **Issues, pull requests and discussions** — the things it lists.
- **Checks and commit statuses** — so a PR can show whether CI passed.
- **Projects** — so views can include project board fields.
- **Metadata** — repository names. Every GitHub App requires this.

It cannot write anything: it can't comment, merge, close, or change a label.
There is no `contents` permission, so it cannot read your source code.

One thing worth being precise about: GitHub's pull request permission is
all-or-nothing, and it technically includes the diff of a PR. gh-viewer never
asks for a diff and never displays one, but the permission itself isn't finer
grained than that on GitHub's side.

Your sign-in token is stored by Firefox on your own machine and is sent only to
`api.github.com`. Nothing is sent anywhere else — there is no server behind this.

## If something looks off

**The list is empty but GitHub's website isn't.** The App probably isn't
installed on the organisation that owns those repos, or is installed but only
on a few repositories. Check *Settings → Applications → gh-viewer*.

**The status bar says "partial".** A field couldn't be read — usually a
permission the App wasn't granted. The rest of the results are still accurate.

**It asks you to connect again.** Your access was revoked on GitHub's side, or
the App was configured to expire tokens. Pressing Connect again fixes it.

**Nothing appears after you press Connect.** The App needs Device Flow enabled;
whoever registered it can turn that on in its settings.
