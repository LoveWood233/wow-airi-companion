# Warcraft quick launch

Date: 2026-10-28

## Context

The desktop companion needs a launch button and editable paths for Battle.net and each Warcraft version.
A filename alone cannot identify a game. Retail and Forever both use `Wow.exe`.

## Decision

The main process owns configuration, file inspection, and process creation.
`shared/wow-launcher.ts` defines the target types, schemas, and translated error codes.
`shared/eventa/wow-launcher.ts` defines the IPC contracts.

The settings page is `/settings/wow-launcher`. It supports Battle.net, Retail, Forever, and Classic, with one default quick-launch target.
The stage toolbar provides quick launch. Its expanded menu opens configuration.
An unconfigured target opens settings instead of starting a program.

Configuration lives in `wow-launcher-v1.json` under the existing Electron user data directory.
A save validates the executable first, writes a temporary file, flushes it, and atomically renames it.
Invalid replacements preserve the previous path. Read errors preserve the original configuration file and block writes.

Every launch inspects the saved executable again. The renderer cannot supply a launch command, arguments, or an unsaved executable path.
Process creation uses `spawn` with `shell: false`, a separate executable path, and fixed arguments.
One operation runs at a time. A successful spawn blocks another launch for three seconds.
The companion does not terminate the game when it exits.

## Windows validation

The first release supports local Windows `.exe` paths. It rejects shortcuts, scripts, URLs, command strings, UNC paths, and alternate data streams.
Inspection reads the PE header and uses Windows Authenticode verification.
The PowerShell script is fixed. The selected path travels through an environment variable and `-LiteralPath`, never through script interpolation.

The signature status must be `Valid`. The signing certificate must identify `Blizzard Entertainment, Inc.`.
The filename, signed original filename, company, and product name must agree with the selected program type.
`FileDescription` is not an identity field because Battle.net uses a Unicode dot in that value.

Game validation also checks the installation directory, `.flavor.info` product code, and active `.build.info` version against the executable version.
`Branch` contains the distribution region, so it does not select the game version.
The inspector rejects an executable that changes during inspection.

| Target | Product | Installation directory | Executable |
| --- | --- | --- | --- |
| Retail | `wow` | `_retail_` | `WoW.exe` |
| Forever | `wowf` | `_forever_` | `Wow.exe` |
| Classic progression | `wow_classic` | `_classic_` | `WoWClassic.exe` |
| Classic Era | `wow_classic_era` | `_classic_era_` | `WoWClassic.exe` |
| Classic Titan | `wow_classic_titan` | `_classic_titan_` | `WoWClassic.exe` |
| Classic Anniversary | `wow_anniversary` | `_anniversary_` | `WoWClassic.exe` |

The documented ARM64 variants are accepted. Titan uses the fixed official argument `-initialgamemode=standard`. Anniversary uses `-initialgamemode=bccfresh`.
Other supported game products use no arguments.
Forever currently requires the confirmed `1.60.x` binary family. New families require an updated validation rule.
Unknown product codes, PTR clients, and beta clients are rejected instead of assigned to a release version.

Battle.net accepts the signed `Battle.net.exe`, `Battle.net Launcher.exe`, and `World of Warcraft Launcher.exe` identities.
The generic Warcraft launcher opens Battle.net. It does not identify or guarantee a particular Warcraft version.
Users can select Battle.net when a game update changes the supported installation layout.

## Boundaries

The launch receipt confirms process creation, not login, patch completion, or entry into the game.
Battle.net and Warcraft retain their normal login and update flows.
The local installation metadata is not signed. Cross-checks prevent selection mistakes and simple renames, not every forged installation.
Inspection does not execute the selected program. Tests never start a real Battle.net or Warcraft process.

## Sources

Product paths, binary names, and fixed arguments were read from Blizzard's product configuration CDN:

- [Retail product configuration](https://level3.blizzard.com/tpr/configs/data/53/02/53020d32e1a25648c8e1eafd5771935f)
- [Forever product configuration](https://level3.blizzard.com/tpr/configs/data/2c/ed/2ced73c17301c297ca062bc7c3583420)
- [Classic progression configuration](https://level3.blizzard.com/tpr/configs/data/f3/37/f337a1b6ece3dacf3ec807287f3c2aa6)
- [Classic Era configuration](https://level3.blizzard.com/tpr/configs/data/c9/93/c9934edfc8f217a2e01c47e4deae8454)
- [Classic Titan configuration](https://level3.blizzard.com/tpr/configs/data/11/a7/11a7ea270082c4636d7c2edbcda7ae94)
- [Classic Anniversary configuration](https://level3.blizzard.com/tpr/configs/data/92/cb/92cbb948f8b043dc019e4447149478d5)
- [Forever version records](https://us.version.battle.net/wowf/versions) confirm the current `1.60.x` family.
- [Blizzard installation instructions](https://wow.blizzard.cn/news/20260930/40570_1315669.html) explain the generic launcher and version selection.
- [Microsoft Authenticode documentation](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/get-authenticodesignature?view=powershell-7.5) defines signature inspection and literal paths.

## Validation

On 2026-10-28, the focused configuration passed 51 tests: 40 Node tests and 11 Chromium tests.
The browser tests use the real Vue, Pinia, UI components, and UnoCSS configuration. They mock only the Electron IPC boundary.
The Node tests use temporary files and mock process creation. They cover persistence, validation failures, version selection, fixed arguments, concurrent requests, and repeated clicks.
The browser tests cover configuration, launch, error messages, and long paths at 360 pixels in both color modes.

From `airi/`, run the focused tests:

```sh
node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.launcher.config.ts
```

The configuration uses Playwright Chromium by default.
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select an installed Chromium executable.
`VITE_LAUNCHER_CAPTURE_DIR` can select an absolute screenshot directory.
The screenshots use the names `wow-launcher-360-light.png` and `wow-launcher-360-dark.png`.
The final run used these overrides with an existing Chromium installation and a temporary screenshot directory.
Visual review found readable controls and complete path text without horizontal overflow.

Five additional checks used the production `WindowsLauncherPlatform.inspect()` against local installations:

| Target | Local executable | Result |
| --- | --- | --- |
| `battle-net` | `E:\Game\Battle.net\Battle.net.exe` | Accepted, `Battle.net`, version `2.53.5.17932` |
| `battle-net` | `E:\Game\Battle.net\Battle.net Launcher.exe` | Accepted, `Battle.net Launcher`, version `2.53.5.17932` |
| `battle-net` | `E:\Game\World of Warcraft\World of Warcraft Launcher.exe` | Accepted, `World of Warcraft Launcher`, version `1.18.10.3140` |
| `retail` | `E:\Game\World of Warcraft\_retail_\Wow.exe` | Accepted, `World of Warcraft`, version `12.1.5.70448` |
| `forever` | `E:\Game\World of Warcraft\_retail_\Wow.exe` | Rejected with `wrong-version` |

These checks read executable metadata, signatures, and installation files. They did not start Battle.net or Warcraft, or save real user configuration.
The checks found inherited PowerShell 7 module paths that prevented Windows PowerShell from loading its signature command.
The inspector now removes inherited `PSModulePath` names without regard to case and selects the native Windows PowerShell module directory.

Strict TypeScript validation passed for the runtime, Windows platform, and their two Node test files, including their imported shared contracts.
From the repository root, run the same command:

```sh
node airi/node_modules/typescript/bin/tsc --ignoreConfig --noEmit --strict --noUnusedLocals --types node --typeRoots airi/node_modules/@types --module ESNext --moduleResolution bundler --target ESNext --resolveJsonModule --esModuleInterop --verbatimModuleSyntax --skipLibCheck airi/apps/stage-tamagotchi/src/main/services/airi/wow-launcher-runtime.ts airi/apps/stage-tamagotchi/src/main/services/airi/wow-launcher-runtime.test.ts airi/apps/stage-tamagotchi/src/main/services/airi/wow-launcher-windows.ts airi/apps/stage-tamagotchi/src/main/services/airi/wow-launcher-windows.test.ts
```

The partial dependency installation blocked these workspace checks. Each command ran from `airi/` with automatic dependency installation disabled.

| Command | Result |
| --- | --- |
| `pnpm --config.verify-deps-before-run=false lint` | Blocked: `moeru-lint` was unavailable |
| `pnpm --config.verify-deps-before-run=false typecheck` | Blocked: `turbo` was unavailable |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-tamagotchi lint` | Blocked: `eslint` was unavailable |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-tamagotchi typecheck` | Blocked: `vue-tsc` was unavailable on the script path |

A separate invocation of a temporary `vue-tsc` installation reached the desktop configuration but found missing dependencies.
The missing entries were `@vue-macros/volar/define-models`, `@vue-macros/volar/define-slots`, `@types/audioworklet`, `electron-vite/node`, `unplugin-info/client`, `vite-plugin-vue-layouts/client`, and `vue-macros/macros-global`.
The focused renderer attempt also lacked Electron types and declarations for dependent workspace packages.
The browser tests passed, but the complete desktop typecheck and workspace lint remain unverified.
The three existing control-island browser suites were also attempted. They stopped during imports because workspace exports from `@proj-airi/i18n`, `@proj-airi/stage-ui`, and `@proj-airi/stage-layouts` were unavailable; none of their assertions ran.
The validation work did not change dependency manifests, lockfiles, or TypeScript configuration files.
