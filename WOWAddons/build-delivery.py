"""Package the companion sources without caches, credentials, or AIRI dependencies."""

from __future__ import annotations

import hashlib
import json
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
AIRI = ROOT.parent / "airi"
DESTINATION = ROOT / "WoWCompanion-2.18.0-source.zip"
BASELINE = "747d4f68aa42180671de3071fb78d5e6129433bd"


def git_paths(*args: str) -> list[str]:
    result = subprocess.check_output(["git", "-C", str(AIRI), *args])
    return [path for path in result.decode("utf-8").split("\0") if path]


def main() -> None:
    entries: dict[str, Path] = {}
    for name in (
        "wow-companion-implementation.html", "魔兽陪伴精灵-使用说明.html", "WoWCompanion-PROTOCOL.md",
        "魔兽陪伴精灵-功能现状与扩展规划.md",
        "Start-WoWCompanion.cmd", "Start-WoWCompanion.ps1",
        "Install-WoWCompanion.ps1", "Install-WoWMacroImport.ps1", "build-delivery.py", "WoWMapCompanion-2.13.0.zip", "WoWForeverCompanion-1.10.0.zip", "WoWMacroImport-1.0.0.zip",
        "research/airi-personas/sylvanas-tone.json",
    ):
        entries[f"WOWAddons/{name}"] = ROOT / name
    for folder in ("WoWMapCompanion", "WoWForeverCompanion", "WoWMacroImport", "WoWCompanionBridge"):
        for path in (ROOT / folder).rglob("*"):
            if not path.is_file() or any(part in (".deps", "__pycache__") for part in path.parts):
                continue
            fixture_json = path.suffix == ".json" and path.parent.name == "fixtures" and path.name.startswith("lua-")
            if path.suffix in (".lua", ".toc", ".md", ".py", ".ps1", ".html", ".bin") or fixture_json:
                entries[f"WOWAddons/{path.relative_to(ROOT).as_posix()}"] = path
    modified_entries = {
        "README.md",
        "apps/stage-tamagotchi/src/renderer/local-routes.ts",
        "apps/stage-tamagotchi/src/renderer/local-routes.browser.test.ts",
        "apps/stage-tamagotchi/src/main/libs/electron/application-menu.ts",
        "apps/stage-tamagotchi/src/main/libs/electron/application-menu.test.ts",
        "apps/stage-tamagotchi/vitest.launcher.config.ts",
        "apps/stage-tamagotchi/vitest.screen-assist.config.ts",
        "packages/stage-ui/src/stores/chat/request-context.ts",
        "packages/stage-ui/src/stores/chat/request-context.test.ts",
        "uno.config.ts",
        "apps/stage-tamagotchi/electron-builder.config.ts",
        "apps/stage-tamagotchi/resources/icon.png",
        "apps/stage-tamagotchi/vitest.config.ts",
        "apps/stage-tamagotchi/src/main/index.ts",
        "apps/stage-tamagotchi/src/main/windows/main/index.ts",
        "apps/stage-tamagotchi/src/renderer/App.vue",
        "apps/stage-tamagotchi/src/renderer/pages/index.vue",
        "apps/stage-tamagotchi/src/renderer/components/stage-islands/controls-island/index.vue",
        "apps/stage-tamagotchi/src/renderer/components/stage-islands/controls-island/controls-island-wow-launcher.vue",
        "apps/stage-tamagotchi/src/renderer/components/stage-islands/controls-island/controls-island-overflow.browser.test.ts",
        "apps/stage-tamagotchi/src/renderer/components/stage-islands/controls-island/controls-island-notifications.browser.test.ts",
        "apps/stage-tamagotchi/src/main/windows/shared/window.test.ts",
        "packages/stage-ui/src/components/scenes/Stage.vue",
        "packages/stage-ui/src/stores/chat.ts",
        "packages/stage-ui/src/stores/chat.contract.test.ts",
        "packages/stage-ui/src/libs/speech/playback-caption.ts",
        "packages/stage-ui/src/libs/speech/playback-caption.test.ts",
        "packages/i18n/src/locales/en/index.ts",
        "packages/i18n/src/locales/zh-Hans/index.ts",
        "packages/i18n/src/locales/en/tamagotchi/stage.yaml",
        "packages/i18n/src/locales/zh-Hans/tamagotchi/stage.yaml",
    }
    tracked_changes = set(git_paths("diff", "--name-only", "-z", "HEAD"))
    changes = set(tracked_changes)
    changes.update(git_paths("ls-files", "--others", "--exclude-standard", "-z"))
    for name in sorted(changes):
        if "/__screenshots__/" in name:
            continue
        if name in modified_entries or name in tracked_changes or (
            name.startswith("packages/i18n/") and Path(name).suffix in (".yaml", ".ts", ".json")
        ) or (
            name.startswith("packages/stage-shared/src/wow-knowledge/") and Path(name).suffix in (".ts", ".json", ".md")
        ) or (
            name.startswith(("apps/stage-tamagotchi/", "packages/stage-ui/", "packages/stage-layouts/", "packages/i18n/", "docs/ai/adr/"))
            and Path(name).name.startswith(("wow-companion", "wow-macro", "wow-addons", "wow-launcher", "wow-screen", "wow-knowledge", "speech-caption-bubble"))
        ):
            entries[f"airi/{name}"] = AIRI / name
    entries["airi/LICENSE"] = AIRI / "LICENSE"
    manifest = {
        "name": "魔兽陪伴精灵",
        "version": "2.18.0",
        "integratedProjectCommit": "61da31e",
        "airiBaseline": BASELINE,
        "airiPackageVersion": "0.12.0-beta.5",
        "instructions": "Desktop entries are changed/new files only. Overlay them onto the specified upstream baseline, then install dependencies and build as described in WOWAddons/wow-companion-implementation.html. Keep the airi and WOWAddons folders side by side. No model credentials, dependencies, compiled application, or user data are included.",
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
