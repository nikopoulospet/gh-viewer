#!/usr/bin/env python3
"""Print the extension's version. The manifest is the single source of truth.

The release workflow derives the tag from this, so a tag and a build can never
disagree about what version they are.
"""

import json
import pathlib
import sys

MANIFEST = pathlib.Path(__file__).resolve().parent.parent / "extension" / "manifest.json"


def main():
    version = json.loads(MANIFEST.read_text())["version"]
    if not version:
        sys.exit("[x] manifest.json has no version")
    print(version)


if __name__ == "__main__":
    main()
