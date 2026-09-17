#!/usr/bin/env python3
"""Check a built .xpi before it is published.

Signing burns a version number at AMO permanently - it can never be reused - so
publishing a file that is unsigned, or that carries the wrong version, costs a
version bump to correct. Cheaper to check first.

  python3 tools/verify_xpi.py dist/gh_viewer-0.2.0.xpi --expect-version 0.2.0
"""

import argparse
import json
import sys
import zipfile

# Mozilla's signature lands in META-INF. Its presence is what distinguishes a
# signed .xpi from the plain zip `web-ext build` produces.
SIGNATURE_MEMBERS = ("META-INF/mozilla.rsa", "META-INF/mozilla.sf")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("xpi")
    ap.add_argument("--expect-version")
    ap.add_argument("--allow-unsigned", action="store_true",
                    help="only check contents, for inspecting a local build")
    args = ap.parse_args()

    problems = []
    with zipfile.ZipFile(args.xpi) as archive:
        names = set(archive.namelist())

        if "manifest.json" not in names:
            sys.exit("[x] no manifest.json inside the archive")
        manifest = json.loads(archive.read("manifest.json"))
        version = manifest.get("version")
        print(f"[i] {manifest.get('name')} {version}")
        print(f"[i] {len(names)} files, {sum(i.file_size for i in archive.infolist())} bytes uncompressed")

        signed = any(member in names for member in SIGNATURE_MEMBERS)
        if signed:
            print("[ok] signed by Mozilla (META-INF present)")
        elif args.allow_unsigned:
            print("[!] unsigned - Firefox will refuse to install this permanently")
        else:
            problems.append("archive is not signed: no META-INF signature")

        if args.expect_version and version != args.expect_version:
            problems.append(f"version is {version}, expected {args.expect_version}")

        # A signed build that forgot a file is worse than a failed build.
        for required in ("manifest.json", "sidebar/panel.html", "lib/store.js"):
            if required not in names:
                problems.append(f"missing {required}")

    for problem in problems:
        print(f"[x] {problem}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
