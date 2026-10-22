"""Package the companion sources without caches, credentials, or AIRI dependencies."""

from __future__ import annotations

import hashlib
import json
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
AIRI = ROOT.parent / "airi"
DESTINATION = ROOT / "WoWCompanion-2.2.0-source.zip"
BASELINE = "747d4f68aa42180671de3071fb78d5e6129433bd"


def git_paths(*args: str) -> list[str]:
    result = subprocess.check_output(["git", "-C", str(AIRI), *args])
    return [path for path in result.decode("utf-8").split("\0") if path]


def main() -> None:
    entries: dict[str, Path] = {}
    for name in (
        "wow-companion-implementation.html", "WoWCompanion-PROTOCOL.md",
        "Start-WoWCompanion.cmd", "Start-WoWCompanion.ps1",
        "Install-WoWCompanion.ps1", "build-delivery.py", "WoWMapCompanion-2.1.1.zip",
    ):
        entries[f"WOWAddons/{name}"] = ROOT / name
    for folder in ("WoWMapCompanion", "WoWCompanionBridge"):
        for path in (ROOT / folder).rglob("*"):
            if not path.is_file() or any(part in (".deps", "__pycache__") for part in path.parts):
                continue
            if path.suffix in (".lua", ".toc", ".md", ".py", ".ps1", ".html", ".bin") or path.name == "lua-wcp1.json":
                entries[f"WOWAddons/{path.relative_to(ROOT).as_posix()}"] = path
    modified_entries = {
        "apps/stage-tamagotchi/electron-builder.config.ts",
        "apps/stage-tamagotchi/src/main/index.ts",
        "apps/stage-tamagotchi/src/renderer/App.vue",
        "packages/i18n/src/locales/en/index.ts",
        "packages/i18n/src/locales/zh-Hans/index.ts",
    }
    changes = set(git_paths("diff", "--name-only", "-z", "HEAD"))
    changes.update(git_paths("ls-files", "--others", "--exclude-standard", "-z"))
    for name in sorted(changes):
        if name in modified_entries or (
            name.startswith(("apps/stage-tamagotchi/", "packages/i18n/", "docs/ai/adr/"))
            and Path(name).name.startswith("wow-companion")
        ):
            entries[f"airi/{name}"] = AIRI / name
    manifest = {
        "name": "WoW Companion",
        "version": "2.2.0",
        "airiBaseline": BASELINE,
        "airiPackageVersion": "0.12.0-beta.5",
        "instructions": "AIRI entries are changed/new files only. Overlay them onto the specified AIRI baseline, then install dependencies and build as described in WOWAddons/wow-companion-implementation.html. Keep the airi and WOWAddons folders side by side. No model credentials, dependencies, compiled application, or user data are included.",
        "files": {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in sorted(entries.items())},
    }
    with zipfile.ZipFile(DESTINATION, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, path in sorted(entries.items()):
            archive.write(path, name)
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    with zipfile.ZipFile(DESTINATION) as archive:
        assert archive.testzip() is None
        for name, expected in manifest["files"].items():
            assert hashlib.sha256(archive.read(name)).hexdigest() == expected, name
    print(f"Created {DESTINATION}: {len(entries)} source files, {DESTINATION.stat().st_size} bytes; all SHA256 checks passed.")


if __name__ == "__main__":
    main()
