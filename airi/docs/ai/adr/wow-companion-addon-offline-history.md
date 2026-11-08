# Addon-owned offline history

The addon records data independently of the desktop process. Disabling the grid does not disable local collection.
Each game profile retains multiple characters inside its account-wide SavedVariables table.
`snapshotJSON` preserves the existing snapshot fields and adds `offlineHistory`. Only the SavedVariables JSON contains this larger history.
The screen protocol keeps its original bounded v3 snapshot and separate equipment frames.

## Collection

- `offlineHistory.balanceCopper` is the exact decimal-string sum of last-known balances for observed characters.
- Each character retains its last snapshot, equipment loadout, money observations, and level records.
- Money rows identify each observed balance change, server observation time, balance, and counter epoch.
- Unknown transaction reasons and purchase details are not inferred.
- Level durations accumulate observed online seconds. Loading, logout, and periods without addon observations do not add offline time.
- The first observed level is partial. A full subsequently observed level is complete. Unobserved level changes remain unknown.

The addon caches the expanded JSON for ten seconds during normal operation and rebuilds it on logout or world departure.
The client writes SavedVariables during reload, logout, or normal game exit. The addon does not write arbitrary disk files.
Unexpected client crashes or power loss can lose changes since the previous client save.
The feature cannot reconstruct sessions that happened before this addon update.

## Desktop recovery

The desktop uses the corresponding executable path from Game Launcher settings to locate `WTF/Account/*/SavedVariables`.
It scans the client directory and its parent every thirty seconds, including when the live companion connection is disabled.
It decodes only the quoted Lua `snapshotJSON` string, parses JSON, and validates character, game, balance, and equipment shapes.
It never evaluates or executes the Lua file. Source files larger than 64 MiB remain untouched and are not imported automatically.
Snapshot-only SavedVariables are supported but contain no recoverable historical records.

The latest valid import per addon account is saved to `wow-companion-<game>-addon-history-v1.json` in the desktop user-data directory.
The fixed character archive also includes these imports under `addonHistory`.
Partial, invalid, older, and cross-game imports cannot replace the last valid history.
Imports preserve offline provenance and never create live-player observations or add historical totals twice to the existing desktop ledger.
The renderer's existing live status and desktop ledger views remain separate from the imported offline archive.

## Validation

Real Lua tests exercise both addon variants without a desktop, logout serialization, reload continuity, multiple characters, exact large balances, and the unchanged screen-frame size.
Desktop tests exercise safe Lua-string decoding, offline imports, restart deduplication, invalid input preservation, and fixed-archive integration.
A real Lua-generated SavedVariables fixture also passed the desktop decoder and importer.
These checks do not claim a live game logout was performed on the user's computer.
