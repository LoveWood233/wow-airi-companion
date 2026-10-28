# Warcraft screenshot assistance

Date: 2026-10-28

## Use

Open **Settings → Game screenshot assistance**. Select a game version or keep automatic window selection.
Configure an image-capable provider and model in **Settings → Modules → Vision** for the conversation's character.
Ask about the current game view in typed chat or voice. `/look` followed by a question explicitly requests a capture.

Examples include a path across terrain, a missing quest NPC, an entrance, a map marker, or visible quest text.
Natural-language matching uses conservative Chinese and English rules. Use `/look` when a phrase does not trigger capture.
Quoted examples, general knowledge questions, refusals, and historical descriptions do not grant capture access.
If the user attaches an image, the existing attachment reader handles it. That request does not capture an additional game frame.

The companion reads one frame and gives guidance in the user's language and character voice.
It separates visible evidence from possible explanations. It requests another view when text, terrain, or an entrance is unclear.
After moving, request another view. This feature has no live video loop or character controls.
One frame cannot establish collision, jump distance, a safe landing, hidden paths, quest phases, or unseen NPC coordinates.

## Capture boundary

`shared/wow-screen-assist.ts` owns the request schema, image contract, and error codes.
`shared/eventa/wow-screen-assist.ts` exposes one Eventa capture request.
The main process registers `setupWowScreenAssist()` independently of the addon telemetry bridge.
The first release supports Windows and the release products recognized by the game launcher inspector.

The native query finds Warcraft process names, executable paths, HWNDs, process creation times, and window state.
The launcher inspector validates the executable's Blizzard signature, product identity, and installation version.
The request can select Retail, Forever, or Classic. Automatic selection requires exactly one candidate window.
Multiple matching windows return an error. The runtime never guesses a title match or falls back to the desktop.

Electron's `desktopCapturer.getSources()` enumerates window thumbnails locally. Only the verified HWND's frame is encoded and returned across IPC.
Other window images are neither returned to the renderer nor sent to a model.
The runtime rechecks the process lifetime and window visibility before and after capture.
Minimized, hidden, closed, changed, empty, black, and nearly uniform frames are rejected.

The image is a JPEG with a maximum size of 1920 × 1080 pixels and 6 MiB.
There is no screenshot cache or image file. A request times out after 30 seconds.
A timed-out OS operation retains the lock until it ends. Its late result is discarded.
Rendering failure and exclusive fullscreen limitations return capture errors. Users can restore the game or try windowed mode.

## Chat ownership

The full desktop stage registers one `ChatRequestContexts` contributor. Settings windows only change preferences.
New local owner sends grant an observation for one session and message ID.
Notices, background tasks, external scene input, `ingest()` input, and historical retries do not grant observations.
Voice input uses the existing completed transcript. The feature does not start an additional transcription request.

The observer runs once before model tool steps. It appends text to a copy of the current user turn's runtime context.
It does not write to shared context state, stored messages, attachments, or the chat asset library.
The observer snapshots its registrations, so removal and registration during a read cannot capture twice for the same request.
Cancellation discards late results. Disabling the feature unregisters the observer and cancels its current read.

The desktop controller uses `useVisionInference()` with the conversation owner's vision selection and a task-specific prompt.
The existing reader has a 60-second inference timeout and respects the turn's cancellation signal.
The image is sent only to the selected vision provider. No provider or credential is created by this feature.
Only the returned observations reach the ordinary chat model. They include the capture time and verified game version.
The prompt gives that game version priority over conflicting addon or knowledge context.

The existing vision activity view keeps a short text preview. Chat diagnostics can show the text added to the provider request.
Raw screenshot bytes do not enter those chat records. The selected provider's own data policy still applies.
Model errors and missing configuration produce explicit unavailable-screen context and translated status messages.
The assistant can then give clearly labeled general guidance without claiming to have inspected the view.

## Validation

The focused tests exercise native capture boundaries with mocked OS and Electron services, request ownership, intent policy, and the real settings UI.
Browser tests use real Vue, Pinia, router, i18n, UnoCSS, and local storage.
The 360-pixel light and dark views were inspected for readable controls and horizontal overflow.
The final focused run passed **111 tests**: 17 capture tests, 76 policy tests, 8 controller tests, 6 context tests, and 4 browser tests.
The launcher regression run passed 51 tests. The independent Warcraft knowledge suites passed 22 tests.
English and Simplified Chinese contain the same 36 screenshot-assistance translation keys.

From `airi/`, run:

```sh
node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.screen-assist.config.ts
node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.launcher.config.ts
```

The browser uses Playwright Chromium. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` optionally selects an installed Chromium executable.
Set `VITE_LAUNCHER_CAPTURE_DIR` to an absolute directory to retain the settings screenshots.

A read-only Windows smoke check ran the actual native window query successfully. No Warcraft window was running.
It did not capture pixels, start the game, or call an external model.
Real game rendering and vision answers remain unverified end to end.

Strict TypeScript validation passed for capture runtime, Windows capture, intent policy, and their tests with the installed Electron declarations.
The actual command ran from the repository root:

```sh
node airi/node_modules/typescript/bin/tsc --ignoreConfig --noEmit --strict --noUnusedLocals --types node --typeRoots airi/node_modules/@types --module ESNext --moduleResolution bundler --target ESNext --resolveJsonModule --esModuleInterop --verbatimModuleSyntax --skipLibCheck airi/node_modules/.pnpm/electron@43.4.1_supports-color@10.2.2/node_modules/electron/electron.d.ts airi/apps/stage-tamagotchi/src/main/services/airi/wow-screen-assist-runtime.ts airi/apps/stage-tamagotchi/src/main/services/airi/wow-screen-assist-runtime.test.ts airi/apps/stage-tamagotchi/src/main/services/airi/wow-screen-assist-windows.ts airi/apps/stage-tamagotchi/src/main/services/airi/wow-screen-assist-windows.test.ts airi/apps/stage-tamagotchi/src/renderer/stores/wow-screen-assist-policy.ts airi/apps/stage-tamagotchi/src/renderer/stores/wow-screen-assist-policy.test.ts
```

Four new chat contract cases cover turn isolation, voice transcripts, non-user input, and uploaded-image priority.
That suite stopped during imports before its assertions ran. Missing `better-auth/vue` and unbuilt `core-agent` dependencies blocked it.
The controller and shared context typecheck also reached missing workspace declarations and provider dependencies.
The passing pure controller and context tests do not replace that full chat integration check.

The workspace has a partial dependency installation. These required commands were attempted with automatic dependency installation disabled:

| Command from `airi/` | Result |
| --- | --- |
| `pnpm --config.verify-deps-before-run=false lint` | Blocked by missing `moeru-lint` |
| `pnpm --config.verify-deps-before-run=false typecheck` | Blocked by missing `turbo` |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-tamagotchi typecheck` | Blocked by missing `vue-tsc` on the script path |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-ui typecheck` | Blocked by missing `vue-tsc` on the script path |

## Sources

- [Electron source IDs](https://www.electronjs.org/docs/latest/api/structures/desktop-capturer-source) describe the Windows HWND mapping.
- [Electron desktop capture](https://www.electronjs.org/docs/latest/api/desktop-capturer) documents source selection and thumbnail size limits.
- [Electron NativeImage](https://www.electronjs.org/docs/latest/api/native-image) documents resizing, pixel access, and JPEG encoding.
- [GetWindowThreadProcessId](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowthreadprocessid) identifies the window's process.
- [IsIconic](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-isiconic) reports minimization.
- [DWM window attributes](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute) define cloaked windows.
