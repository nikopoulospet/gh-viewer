#!/usr/bin/env python3
"""Catch redeclaration collisions between the extension's classic scripts.

Every <script src> on a page shares one global scope, so a top-level `const` of
the same name in two of them is a SyntaxError that silently kills the second
file - the page half-works and the console blames whatever used it. There is no
JS runtime in this repo to catch that, so check it statically.

  python3 tools/check_scripts.py
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / "extension"

SCRIPT = re.compile(r'<script src="([^"]+)"', re.I)
DECL_AT = re.compile(r"(const|let|class|function)\s+([A-Za-z_$][\w$]*)")


def top_level_names(source):
    """Names declared at brace depth 0, which is the only depth that collides.

    Scans with a tiny state machine rather than matching indentation, so a file
    wrapped in an IIFE is correctly seen as declaring nothing.
    """
    depth, i, n = 0, 0, len(source)
    spans = []          # (start, end) of depth-0 regions
    region_start = 0
    while i < n:
        c = source[i]
        two = source[i:i + 2]
        if two == "//":
            i = source.find("\n", i)
            if i == -1:
                break
            continue
        if two == "/*":
            end = source.find("*/", i + 2)
            i = n if end == -1 else end + 2
            continue
        if c in "\"'`":
            quote, i = c, i + 1
            while i < n:
                if source[i] == "\\":
                    i += 2
                    continue
                if source[i] == quote:
                    i += 1
                    break
                i += 1
            continue
        if c == "{":
            if depth == 0:
                spans.append((region_start, i))
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                region_start = i + 1
        i += 1
    spans.append((region_start, n))

    names = {}
    for start, end in spans:
        for kind, name in DECL_AT.findall(source[start:end]):
            names.setdefault(name, kind)
    return names


def main():
    failures = 0

    for page in sorted(ROOT.rglob("*.html")):
        srcs = SCRIPT.findall(page.read_text())
        if len(srcs) < 2:
            continue

        fatal, warn = {}, {}
        for src in srcs:
            path = (page.parent / src).resolve()
            if not path.exists():
                print(f"[x] {page.name}: missing script {src}")
                failures += 1
                continue
            for name, kind in top_level_names(path.read_text()).items():
                bucket = warn if kind == "function" else fatal
                bucket.setdefault(name, []).append(path.name)

        label = page.relative_to(ROOT)
        clashes = {n: f for n, f in fatal.items() if len(f) > 1}
        shadows = {n: f for n, f in warn.items() if len(f) > 1}

        for name, files in clashes.items():
            print(f"[x] {label}: `{name}` declared at top level in "
                  f"{' and '.join(files)} — the second script will not run")
            failures += 1
        for name, files in shadows.items():
            print(f"[!] {label}: function `{name}` defined in "
                  f"{' and '.join(files)} — the later one silently wins")

        if not clashes and not shadows:
            print(f"[ok] {label}: {len(srcs)} scripts, no collisions")

    print("\n" + ("no fatal collisions" if not failures else f"{failures} problem(s)"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
