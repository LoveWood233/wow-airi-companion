# Warcraft macro import

Date: 2026-10-29

## Behavior

The desktop registers `wow_import_macro` as a default chat tool.
The user requests a macro in chat. The model supplies its body and the observed game version.
The tool description excludes examples, quoted requests, and proactive events.
The main process validates the body and discovers one verified Warcraft window for that game.

`CompanionBridgeRuntime.runMacroImport()` starts a fixed Python workflow. It passes JSON through stdin, without a shell.
The parent keeps stdin open as a lifetime lease. Stop, disable, or application shutdown closes that lease and cancels input.
The helper copies the macro into the clipboard and activates the game window.
It waits up to 90 seconds for combat to end before it sends the first key.

The helper opens chat, waits for chat focus, enters `/import-marco <requestId>`, and waits for the addon's focused input box.
It pastes the body, checks its length and hash, and sends Ctrl+Enter.
Only a matching `saved` receipt confirms success. The helper never executes the saved macro.
An input failure, timeout, lost focus, new combat, character change, or stale telemetry stops the workflow without retries.

## Game addon

`WOWAddons/WoWMacroImport` contains the standalone import UI and validation.
The button and Ctrl+Enter use the same validation and save function.
Normal Enter inserts a newline. Escape closes the window.
The plugin checks registered slash commands and the 255-byte UTF-8 budget. It does not establish runtime spell or condition availability.
When available, `loadstring` checks Lua syntax without executing the resulting function.
The plugin updates only its own unchanged character macro, named `WCP Import`.
It reads the saved body back before it reports success.

## Transport

Retail and Forever telemetry addons call `WoWCompanionMacroImport.Telemetry()` once per macro frame.
Macro frames use one in two data slots when the addon exists. Character heartbeat slots remain unchanged.
The bridge validates the frame and matches its session and GUID to the live character.
The serial must increase. Duplicate frames do not refresh the receipt or the character heartbeat.
The bridge exposes `macroImport` only for fresh, live, error-free screen data.
No new HTTP mutation endpoint is added.

The desktop binds an operation to the bridge instance, account, GUID, session, and verified Windows process lifetime.
Each stage also checks the request ID and current input focus.
The body hash prevents accidental content mismatches. It is not an authentication mechanism.
Windows input uses fixed SendInput sequences. No model text can select keys, executable paths, or shell commands.
A process-wide Windows mutex prevents concurrent macro import helpers.

## Delivery and limits

The Electron resource list includes both Python helper modules.
`Install-WoWMacroImport.ps1` installs the importer and the matching telemetry addon with backups.
The existing clipboard is replaced with the requested macro. It is not restored.
The supported profiles are Retail and Forever. Other profiles have no live combat telemetry in this workflow.
The game must accept foreground input at the desktop process's integrity level.
Game rendering and real keyboard handling require live-client verification.

## Sources

- [BetterGI text input](https://github.com/babalae/better-genshin-impact/blob/main/BetterGenshinImpact/Core/Script/Dependence/GlobalMethod.cs)
- [Windows SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)
- [Blizzard macro UI source](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_MacroUI/Blizzard_MacroUI.lua)

The implementation uses the existing Python runtime and Windows APIs. No BetterGI source is copied or linked.
