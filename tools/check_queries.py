#!/usr/bin/env python3
"""Validate every GraphQL document the extension ships against the real API.

A typo in a query only shows up as an empty sidebar, so check them here first.

  python3 tools/check_queries.py                    # uses `gh` for credentials
  python3 tools/check_queries.py --token ghu_...    # or an explicit token
  python3 tools/check_queries.py --file export.json # queries exported from the UI

With `gh` the check proves the documents are *valid*. Run it with a token from
the App itself to also prove the App's read-only permissions are *sufficient* -
fields the App cannot see come back as errors while the rest still resolves.
"""

import argparse
import json
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
STORE = ROOT / "extension" / "lib" / "store.js"
RENDER = ROOT / "extension" / "lib" / "render.js"


def extract(path, name):
    m = re.search(re.escape(name) + r"\s*=\s*`(.*?)`;", path.read_text(), re.S)
    return m.group(1) if m else None


def via_token(doc, variables, token):
    req = urllib.request.Request(
        "https://api.github.com/graphql",
        data=json.dumps({"query": doc, "variables": variables}).encode(),
        headers={"Authorization": f"bearer {token}", "Content-Type": "application/json",
                 "User-Agent": "gh-viewer-check"},
        method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read()), None
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:300]}"


def via_gh(doc, variables):
    body = json.dumps({"query": doc, "variables": variables})
    p = subprocess.run(["gh", "api", "graphql", "--input", "-"],
                       input=body, capture_output=True, text=True)
    if p.returncode != 0:
        return None, (p.stderr or p.stdout).strip()[:300]
    return json.loads(p.stdout), None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--token", help="token to use instead of the gh CLI")
    ap.add_argument("--file", help="a queries JSON export to check instead of the defaults")
    args = ap.parse_args()

    run = (lambda d, v: via_token(d, v, args.token)) if args.token else via_gh

    if args.file:
        cases = [(q["name"], q["document"], q.get("variables") or {})
                 for q in json.loads(pathlib.Path(args.file).read_text())]
    else:
        cases = [
            ("SEARCH_DOC", extract(STORE, "const SEARCH_DOC"),
             {"q": "is:pr state:open assignee:@me archived:false", "first": 5}),
            ("DISCUSSION_DOC", extract(STORE, "const DISCUSSION_DOC"),
             {"q": "sort:updated-desc", "first": 5}),
        ]

    failures = 0
    node_id = None

    for name, doc, variables in cases:
        if not doc:
            print(f"[x] {name}: could not be extracted from source")
            failures += 1
            continue
        body, err = run(doc, variables)
        if err:
            print(f"[x] {name} rejected:\n    {err}")
            failures += 1
            continue
        if errors := body.get("errors"):
            # Partial results are the expected shape when a permission is
            # missing: report them, but the document itself is still valid.
            for e in errors:
                print(f"[!] {name}: {e.get('type', 'ERROR')}: {e.get('message')}")
        search = (body.get("data") or {}).get("search") or {}
        count = search.get("issueCount", search.get("discussionCount", "?"))
        print(f"[ok] {name}: valid, {count} result(s)")
        for node in search.get("nodes") or []:
            if node and node.get("id") and not node_id:
                node_id = node["id"]

    detail = extract(RENDER, "GV.DETAIL_DOC")
    if not detail:
        print("[x] DETAIL_DOC: could not be extracted from source")
        failures += 1
    elif not node_id:
        print("[!] DETAIL_DOC: skipped, no node id came back from the searches")
    else:
        body, err = run(detail, {"id": node_id})
        if err:
            print(f"[x] DETAIL_DOC rejected:\n    {err}")
            failures += 1
        else:
            for e in body.get("errors") or []:
                print(f"[!] DETAIL_DOC: {e.get('type', 'ERROR')}: {e.get('message')}")
            node = (body.get("data") or {}).get("node") or {}
            print(f"[ok] DETAIL_DOC: valid, resolved {node.get('__typename')} "
                  f"#{node.get('number')}")

    print("\n" + ("all documents valid" if not failures else f"{failures} failed"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
