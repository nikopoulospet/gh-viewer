#!/usr/bin/env python3
"""Build the Chrome (Manifest V3) package from the shared source tree.

One source tree serves both browsers. Everything in extension/ is shared; this
script copies it, overlays the handful of Chrome-specific files from chrome/,
and rewrites the manifest for MV3 and the Side Panel API.

  python3 tools/build_chrome.py            # -> dist/chrome/
  python3 tools/build_chrome.py --zip      # also dist/gh-viewer-chrome-<version>.zip
"""

import argparse
import json
import pathlib
import shutil
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "extension"
OVERLAY = ROOT / "chrome"
DIST = ROOT / "dist" / "chrome"

# Chrome rejects SVG in the manifest, so the icon set is the rasterised one.
ICONS = {size: f"icons/app-{size}.png" for size in (16, 32, 48, 128)}


def chrome_manifest(firefox):
    manifest = {
        "manifest_version": 3,
        "name": firefox["name"],
        "version": firefox["version"],
        "description": firefox["description"],
        "icons": ICONS,
        # MV3 splits permissions: API permissions stay, hosts move out.
        "permissions": ["storage", "tabs", "sidePanel"],
        "host_permissions": ["https://github.com/login/*"],
        "background": {"service_worker": "background.js"},
        # The Side Panel API is Chrome's equivalent of sidebar_action. There is
        # no open_at_install equivalent; the panel opens on the first icon click.
        "side_panel": {"default_path": "sidebar/panel.html"},
        "action": {
            "default_title": firefox["browser_action"]["default_title"],
            "default_icon": ICONS,
        },
        "options_ui": firefox["options_ui"],
        "minimum_chrome_version": "114",  # when sidePanel shipped
    }
    return manifest


def build(zip_it=False):
    firefox = json.loads((SOURCE / "manifest.json").read_text())

    if DIST.exists():
        shutil.rmtree(DIST)
    shutil.copytree(SOURCE, DIST)

    # Firefox-only assets: the SVG icons use context-fill, which Chrome neither
    # accepts in a manifest nor renders.
    (DIST / "manifest.json").unlink()
    for svg in ("icons/icon.svg", "icons/app.svg"):
        (DIST / svg).unlink(missing_ok=True)

    replaced = []
    for path in OVERLAY.rglob("*"):
        if path.is_file():
            target = DIST / path.relative_to(OVERLAY)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
            replaced.append(str(path.relative_to(OVERLAY)))

    manifest = chrome_manifest(firefox)
    (DIST / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    print(f"[ok] built {DIST.relative_to(ROOT)} (manifest v3, version {manifest['version']})")
    print(f"[i] overlaid from chrome/: {', '.join(replaced) or 'nothing'}")

    missing = [p for p in ICONS.values() if not (DIST / p).exists()]
    if missing:
        sys.exit(f"[x] missing icons: {missing}\n"
                 "    regenerate with: rsvg-convert -w N -h N extension/icons/app.svg "
                 "-o extension/icons/app-N.png")

    # Anything still referencing the Firefox-only namespace would break silently
    # in Chrome, where `browser` exists only because lib/compat.js aliases it.
    for html in DIST.rglob("*.html"):
        text = html.read_text()
        if "browser." in text and "compat.js" not in text:
            sys.exit(f"[x] {html.name} uses browser.* without loading lib/compat.js")

    if zip_it:
        archive = ROOT / "dist" / f"gh-viewer-chrome-{manifest['version']}.zip"
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
            for f in sorted(DIST.rglob("*")):
                if f.is_file():
                    z.write(f, f.relative_to(DIST).as_posix())
        print(f"[ok] {archive.relative_to(ROOT)} ({archive.stat().st_size // 1024} KB)")

    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", action="store_true", help="also produce an upload-ready zip")
    return build(ap.parse_args().zip)


if __name__ == "__main__":
    sys.exit(main())
