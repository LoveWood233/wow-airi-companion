# WoW companion

The desktop app reads the local WoWCompanionBridge service at `http://127.0.0.1:18765`.
The service decodes the addon screen grid. AIRI does not read game process memory.

## Ownership

Electron main polls the service and stores preferences in the AIRI user data directory.
Eventa carries settings and cached observations between main and renderer processes.
Only the main character window adds context and dispatches character notifications.
Closing settings does not stop the poller.
Calibration and demo commands suspend new HTTP reads until they finish.
Older responses cannot replace the current command result or restore observations after settings disable the companion.

The settings entry is **WoW Companion** at `/settings/wow-companion`.
The page provides calibration, reminder preferences, a clearly marked demo, recent game events, and account gold totals.
Chat, character animation, and speech use the existing AIRI configuration.

## Gold ledger

The addon observes `GetMoney()` on `PLAYER_MONEY` and stores separate cumulative inflow and outflow counters.
The first balance sample does not count existing gold as income.
The WCP1 envelope remains unchanged. Snapshot version 2 adds account, counter segment, balance, inflow, and outflow fields.
The addon, bridge, and desktop app must upgrade together.

The main process owns the persistent ledger. Settings and character windows read the same state through Eventa.
Only live, online screen observations without capture errors enter the ledger. Demo and stale observations cannot change totals.
The source key combines the local account identifier, character GUID, and counter segment.
Repeated observations do not add the same counters again. A session change retains the existing accounting baseline.
Decreasing counters within one segment are rejected. Old segments cannot replace a newer segment.
After restoring old addon counters, both source counters must catch up before that character resumes ledger updates.

Source amounts use safe integer copper. Account and character totals use BigInt, with decimal strings across storage and IPC.
The display converts copper to exact gold, silver, and copper units. It also shows net flow and last known wallet totals.
Users can name account groups. Offline accounts remain visible.

The ledger uses temporary files and atomic replacement in the AIRI user data directory.
An unreadable or invalid ledger stops ingestion and displays an error. The app preserves the original file for recovery.
Write failures retain in-memory data and display a storage error. Later saves retry the pending state.

The account identifier comes from account-wide addon SavedVariables, not Battle.net account access.
Account balance sums the last known wallets of observed characters. Bank balances are not included.
Mail, trades, and bank transfers count as wallet flows. Transfers between owned characters affect both inflow and outflow.
The ledger does not assign categories or dates to transactions. Offline cumulative changes do not provide exact transaction times.
Activity without the addon and counters lost before a game save cannot be reconstructed.

## Notification rules

- The first observation establishes a baseline.
- A new decoder instance, character, or session establishes a new baseline.
- Level increases, new locations, death, and resurrection can trigger a short reply.
- Muting keeps context updates but discards proactive notifications.
- Combat and the cooldown retain one event. An upgrade takes priority over a zone change.
- Deferred events expire after 30 seconds.
- Stale capture removes the current game context.
- Demo context and reactions require a separate opt-in.
- Game events do not grant permission to execute game actions.

## Setup

1. Start the Python bridge.
2. Start the modified AIRI desktop app.
3. Open **Settings → WoW Companion**.
4. Match the capture origin and cell size to the visible addon grid.
5. Configure the existing AIRI chat model and voice.
6. Use **Connection test** to check event flow without a game login.

The decoder uses physical desktop pixels. Window borders and additional monitors change the capture origin.
A minimized, covered, or frozen grid cannot supply fresh observations.
Event history records observations. It does not confirm a model response or audio playback.

## Checks

The policy tests cover baselines, decoder restarts, identity changes, stale capture, demo isolation, combat delay, cooldown, and input validation.
HTTP tests cover request ordering, failed commands, and the real Python service contract.
Gold tests cover cumulative differences, reloads, character and account grouping, exact totals, storage recovery, and invalid observations.
Run the desktop typecheck and targeted Vitest tests before a release.
