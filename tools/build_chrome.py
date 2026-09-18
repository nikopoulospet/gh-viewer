#!/usr/bin/env python3
"""Build the Chrome (MV3) extension from the Firefox source tree.

extension/ stays the single source of truth: every library, page and stylesheet
is shared verbatim. Only the handful of things the two browsers genuinely
disagree about are rewritten here, so a change to the panel never has to be
made twice.

What differs, and why:
  * sidebar_action -> side_panel. Different names for the same idea, and the
    Chrome one needs a "sidePanel" permission to go with it.
  * background.scripts -> background.service_worker, with chrome/background.js
    in place of the Firefox file: Chrome has no sidebarAction.toggle().
  * browser_specific_settings is Gecko-only and Chrome rejects the manifest
    outright if it is left in.
  * Icons are rasterised. Chrome refuses to load an extension whose icon is an
    SVG, so the same source SVG is rendered to the PNG sizes Chrome expects.

  python3 tools/build_chrome.py              # dist/chrome/, to load unpacked
  python3 tools/build_chrome.py --zip        # also dist/gh-viewer-chrome-<v>.zip
"""

import argparse
import json
import pathlib
import shutil
import subprocess
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "extension"
CHROME = ROOT / "chrome"
ICON_SIZES = (16, 32, 48, 128)

# Chrome 114 is where sidePanel landed; below that the manifest loads but the
# panel never opens, which is worse than refusing to install.
MIN_CHROME = "114"

# Pinned, with sorted entries, so a commit always packages byte-identically.
ZIP_EPOCH = (1980, 1, 1, 0, 0, 0)

# Dropping any of these yields a zip that installs and then fails silently.
REQUIRED = ("manifest.json", "background.js", "sidebar/panel.html",
            "options/options.html", "lib/store.js", "lib/compat.js")


def rasterise(svg, out_dir):
    """Render the source SVG to the PNG sizes Chrome looks for."""
    if not shutil.which("rsvg-convert"):
        sys.exit("rsvg-convert is missing - run inside `nix develop`")
    icons = {}
    for size in ICON_SIZES:
        png = out_dir / f"icon-{size}.png"
        subprocess.run(
            ["rsvg-convert", "--width", str(size), "--height", str(size),
             "--output", str(png), str(svg)],
            check=True)
        icons[str(size)] = f"icons/{png.name}"
    return icons


def to_chrome(manifest, icons):
    m = json.loads(json.dumps(manifest))  # copied so the source is never edited

    m.pop("browser_specific_settings", None)
    m["minimum_chrome_version"] = MIN_CHROME

    sidebar = m.pop("sidebar_action")
    m["side_panel"] = {"default_path": sidebar["default_panel"]}
    if "sidePanel" not in m["permissions"]:
        m["permissions"].append("sidePanel")

    m["background"] = {"service_worker": "background.js"}

    m["icons"] = icons
    m["action"]["default_icon"] = icons

    # User-visible strings name Firefox's sidebar, which is the wrong noun in
    # the Web Store listing and on the toolbar button's tooltip.
    m["description"] = m["description"].replace("Firefox sidebar", "Chrome side panel")
    m["action"]["default_title"] = m["action"]["default_title"].replace(
        "sidebar", "side panel")
    return m


def build(out):
    if out.exists():
        shutil.rmtree(out)
    # The source tree is copied whole rather than file by file: anything added
    # to extension/ later ships to Chrome without a list here to update.
    shutil.copytree(SOURCE, out)

    icons = rasterise(SOURCE / "icons" / "icon.svg", out / "icons")
    (out / "icons" / "icon.svg").unlink()

    shutil.copy(CHROME / "background.js", out / "background.js")

    manifest = json.loads((SOURCE / "manifest.json").read_text())
    (out / "manifest.json").write_text(
        json.dumps(to_chrome(manifest, icons), indent=2) + "\n")

    return out


def package(built, version):
    """Zip the build for distribution, and check what came out.

    One top-level folder rather than the zip root, so unzipping gives a single
    directory to point "Load unpacked" at. (A Web Store upload would want the
    opposite - manifest at the root - and so would need repackaging.)
    """
    name = f"gh-viewer-chrome-{version}"
    archive = built.parent / f"{name}.zip"

    files = sorted(p for p in built.rglob("*") if p.is_file())
    with zipfile.ZipFile(archive, "w") as out:
        for path in files:
            info = zipfile.ZipInfo(f"{name}/{path.relative_to(built).as_posix()}",
                                   date_time=ZIP_EPOCH)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            out.writestr(info, path.read_bytes())

    with zipfile.ZipFile(archive) as out:
        names = set(out.namelist())
        missing = [f for f in REQUIRED if f"{name}/{f}" not in names]
        if missing:
            sys.exit(f"[x] {archive.name} is missing {', '.join(missing)}")
        packaged = json.loads(out.read(f"{name}/manifest.json"))["version"]
        if packaged != version:
            sys.exit(f"[x] packaged version is {packaged}, expected {version}")

    return archive


def relative(path):
    return path.relative_to(ROOT) if path.is_relative_to(ROOT) else path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=pathlib.Path, default=ROOT / "dist" / "chrome")
    parser.add_argument("--zip", action="store_true",
                        help="also package the build for distribution")
    args = parser.parse_args()

    out = build(args.out.resolve())
    print(f"[ok] chrome build -> {relative(out)}")

    if args.zip:
        version = json.loads((SOURCE / "manifest.json").read_text())["version"]
        archive = package(out, version)
        size = archive.stat().st_size
        print(f"[ok] packaged      -> {relative(archive)} ({size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
