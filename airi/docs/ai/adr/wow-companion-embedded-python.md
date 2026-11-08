# Embedded Python for Windows releases

## Decision

Windows x64 releases include CPython 3.14.10 in `resources/wow-companion-python`.
The Python Software Foundation published this release on October 25, 2026.

The bridge uses Python's standard library, Windows GDI, and ctypes.
It does not need Pillow, pip, or a target-machine Python installation.

The isolated `python314._pth` permits three import locations:

- `python314.zip`, the bundled standard library
- `.`, the runtime directory and native extension modules
- `../wow-companion-bridge`, the companion's own bridge modules

The interpreter does not import `site` or machine and user site-packages.
Each bridge, macro helper, and interpreter probe uses `-B -X utf8`.
These flags prevent bytecode writes and enforce UTF-8 even when isolated mode ignores environment variables.

## Runtime selection

`CompanionBridgeRuntime` checks the bundled runtime before machine Python.
An incomplete or broken bundled directory produces a prerequisite error.
An ASAR application or release manifest also requires that directory.
It cannot silently use a different machine interpreter.

A development checkout without packaged runtime resources can use Python from PATH.
The Windows Store aliases remain excluded.

The parent owns a hidden bridge through stdin.
Closing that pipe stops only the owned bridge.
Bundled settings and runtime files remain separate from the writable user profile.

## Reproduce the resources

Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File apps/stage-tamagotchi/scripts/companion-release/prepare-python.ps1` from the repository root.

The script downloads the fixed official archive and checks its published SHA256 before extraction.
It preserves `LICENSE.txt` and records source URLs, modifications, file sizes, and file hashes in `runtime-source.json`.
Repeated runs check the existing files rather than replacing an unrecognized resource directory.

Official release: <https://www.python.org/downloads/release/python-31410/>

Archive: <https://www.python.org/ftp/python/3.14.10/python-3.14.10-embed-amd64.zip>

Published archive SHA256: `90905e64a840557d8c1bc4f5b74db3d7ee85e3ffb217611cac1c7813acea4159`

## Verification

The runtime test suite accepts these explicit test paths:

- `AIRI_WOW_RUNTIME_TEST_PYTHON`: an interpreter for existing source-checkout lifecycle tests
- `AIRI_WOW_RUNTIME_TEST_EMBEDDED`: the prepared bundled `python.exe`
- `AIRI_WOW_RUNTIME_TEST_BRIDGE`: the bridge source directory for a packaged module-closure test

The embedded tests clear PATH and use independent temporary profiles and loopback ports.
They test health, lifecycle ownership, and Chinese macro text through a fake input helper.
The real bridge test starts paused and never captures the screen or sends game input.
