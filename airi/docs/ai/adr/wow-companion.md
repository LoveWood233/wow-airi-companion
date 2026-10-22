# WoW companion

The desktop app manages WoWCompanionBridge and reads its service at `http://127.0.0.1:18765`.
The service decodes the addon screen grid. AIRI does not read game process memory.

## Ownership

Electron main starts a hidden Python child process and waits for a healthy service.
It polls the service and stores preferences in the AIRI user data directory.
Eventa carries settings and cached observations between main and renderer processes.
Only the main character window adds context and dispatches character notifications.
Closing settings does not stop the poller.
Calibration and demo commands suspend new HTTP reads until they finish.
Older responses cannot replace the current command result or restore observations after settings disable the companion.

The settings entry is **WoW Companion** at `/settings/wow-companion`.
The page provides calibration, reminder preferences, a clearly marked demo, recent game events, and account gold totals.
Chat, character animation, and speech use the existing AIRI configuration.

## Bridge lifecycle

Release 2.2.0 adds automatic bridge management. The addon remains at 2.1.1.
Users start AIRI and enable the companion connection. They do not need a separate bridge launcher.
Python 3.10 or later remains a local dependency. The bridge uses only the Python standard library.
The release includes bridge scripts but does not include a Python interpreter.
This integration manages a Python process. It does not move the decoder into JavaScript.
Real screen capture requires Windows.

The source layout places `airi` and `WOWAddons` beside each other.
Packaged builds include bridge scripts through `extraResources`.
Source builds retain the bridge directory's `bridge-config.json`.
Packaged builds store calibration at `wow-companion-bridge/bridge-config.json` under the AIRI user data directory.
They copy an available source configuration once, without replacing existing settings.
The runtime retains the last 4KB of Python error output in memory for startup diagnostics.
The runtime checks the local service before it starts a child process.
A compatible external bridge is reused. An incompatible service reports an error.
The runtime does not stop external processes or replace another service on the port.

Startup failures trigger retries with a delay. The settings page shows the connection status, capture status, and startup errors.
Closing the settings window retains the connection.
Disabling the connection stops the child process that AIRI owns. Enabling the connection starts it again.
Exiting AIRI also stops its child process. External bridge processes remain active.
The child uses `--managed-stdin` to detect a closed parent pipe.
This pipe also stops the child after an AIRI crash or forced exit.

The standalone launcher remains available for diagnostics through `Start-WoWCompanion.ps1 -BridgeOnly`.
An external bridge retains its separate lifecycle. Users stop that bridge with its own stop script.

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

1. Install Python 3.10 or later on Windows.
2. Start the modified AIRI desktop app.
3. Open **Settings → WoW Companion**.
4. Enable the companion connection.
5. Wait for the bridge to start or connect to an existing service.
6. Match the capture origin and cell size to the visible addon grid.
7. Configure the existing AIRI chat model and voice.
8. Use **Connection test** to check event flow without a game login.

After an update, exit the old AIRI process before you start the new build.
The launcher does not replace an existing AIRI process.
Normal use requires no separate terminal or bridge window.

If startup fails, read the error in the settings page.
For a missing Python error, install Python 3.10 or later and restart AIRI.
For missing bridge files, restore the source layout or reinstall the complete desktop build.
For a port conflict, identify the process on port 18765 before you stop it.
After you correct the error, wait for the retry or disable and enable the connection.

The decoder uses physical desktop pixels. Window borders and additional monitors change the capture origin.
A minimized, covered, or frozen grid cannot supply fresh observations.
Event history records observations. A recorded event does not mean that the model replied or audio played.

## Checks

The policy tests cover baselines, decoder restarts, identity changes, stale capture, demo isolation, combat delay, cooldown, and input validation.
HTTP tests cover request ordering, failed commands, and the real Python service contract.
Gold tests cover cumulative differences, reloads, character and account grouping, exact totals, storage recovery, and invalid observations.
Lifecycle tests cover automatic startup, external service reuse, retry delays, owned child cleanup, and parent pipe closure.
Run the desktop typecheck and targeted Vitest tests before a release.
