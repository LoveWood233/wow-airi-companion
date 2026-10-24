# WoW companion

The desktop app manages separate Retail and Forever profiles through WoWCompanionBridge.
The service decodes the addon screen grid. AIRI does not read game process memory.

## Ownership

Electron main starts a hidden Python child process and waits for a healthy service.
It polls the service and stores preferences in the AIRI user data directory.
Eventa carries settings and cached observations between main and renderer processes.
Only the main character window adds context and dispatches character notifications.
Closing settings does not stop the poller.
Calibration and demo commands suspend new HTTP reads until they finish.
Older responses cannot replace the current command result or restore observations after settings disable the companion.

The Retail settings page is `/settings/wow-companion`. The Forever page is `/settings/wow-companion-forever`.
Each page provides calibration, reminder preferences, a clearly marked demo, recent game events, and account gold totals.
Chat, character animation, and speech use the existing AIRI configuration.

## Game profiles

Release 2.3.0 adds the Forever profile. The Retail addon remains at 2.1.1.
Forever is not available for client validation yet. Its separate addon is a preparation build.
The Forever connection starts disabled. Both connections can run together after the user enables them.

| Setting | Retail | Forever |
| --- | --- | --- |
| Game key | `retail` | `forever` |
| Loopback port | `18765` | `18766` |
| Screen protocol | `WCP1` | `WCF1` |
| Capture file | `bridge-config.json` | `bridge-config-forever.json` |
| AIRI settings file | `wow-companion-v1.json` | `wow-companion-forever-v1.json` |
| Gold ledger | `wow-companion-gold-v1.json` | `wow-companion-forever-gold-v1.json` |

Retail retains its existing files and preferences. Each profile owns a client, process runtime, event cache, and gold ledger.
The same account identifier in both games produces separate totals and account labels.
Each profile has a separate notification baseline, context key, and reaction lane.
Closing or disabling one profile does not stop the other profile.

Every Eventa request includes an explicit `game` key. Main validates this key before selecting a fixed profile.
Mutations carry `settings`, `capture`, or `request` beside the game key. Responses contain the selected game and its state.
The renderer cannot choose a service address, executable, or storage path.
Capture and demo commands require an enabled connection and a healthy service for that game.

Retail bridge releases 2.1 and 2.2 remain supported through their `WCP1` health response.
Their status responses can omit game identity. Later responses must match any identity fields that they contain.
Forever requires a 2.3 service with `game: forever` and `protocol: WCF1` in health and status responses.
The runtime rejects a bridge from the other game. The HTTP client also rejects observations from the other game.
Snapshot version 2 remains the shared payload format. The screen envelope identifies the game before the bridge accepts the payload.

## Bridge lifecycle

Release 2.2.0 adds automatic bridge management. The addon remains at 2.1.1.
Users start AIRI and enable the companion connection. They do not need a separate bridge launcher.
Python 3.10 or later remains a local dependency. The bridge uses only the Python standard library.
The release includes bridge scripts but does not include a Python interpreter.
This integration manages a Python process. It does not move the decoder into JavaScript.
Real screen capture requires Windows.

The source layout places `airi` and `WOWAddons` beside each other.
Packaged builds include bridge scripts through `extraResources`.
Source builds retain each profile's capture file in the bridge directory.
Packaged builds store both capture files under `wow-companion-bridge` in the AIRI user data directory.
They copy an available source configuration once, without replacing existing settings.
The runtime passes `--game retail` or `--game forever` to each owned bridge process.
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
Snapshot version 2 adds account, counter segment, balance, inflow, and outflow fields to both screen protocols.
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

## New equipment observations

Both profiles accept equipment records from the screen decoder. The frame size and the character snapshot format stay unchanged.
The addon sends equipment in separate fragments. The bridge publishes a record only after it receives and validates all fragments.
The desktop HTTP schema checks record size, UTF-8 field limits, finite attributes, and the maximum list length.
A malformed equipment frame does not replace the current character snapshot or change the gold ledger.
The independent `equipmentError` field reports incomplete transfers in the equipment panel.

Published bridges without `equipment` or `equipmentError` remain supported permanently.
An absent equipment list means that this source supplied no equipment observations. It does not imply that the character owns no equipment.

Each profile saves its ten most recent bag additions across all observed characters in that game version.
Electron main owns this history. Settings and character windows read the same history through Eventa.
The list retains receipt order from oldest to newest. The settings view reverses this order to show the newest record first.
After ten records, each new record removes the oldest. Repeated screen observations do not create another history record.
Each entry retains its original character name, realm, account identifier, local receipt time, and complete equipment record.
History remains available after restarts, character changes, session changes, capture resets, demo switches, and disabled connections.
Storage errors appear beside the history and do not hide readable records.

The bridge retains current-session records separately in memory.
Character changes, session changes, capture resets, and demo switches clear these bridge records without deleting the desktop history.
Login inventory establishes a baseline. Existing bag items are not new acquisitions.
Bag additions include purchases, mail, and bank withdrawals. The records do not establish the acquisition source or current equipment slots.

The equipment view shows item names, types, quality, item levels, numeric attributes, and original tooltip text.
Known attribute keys have translated labels. Unknown keys retain their original names.
Nullable fields remain unavailable. Numeric zero remains zero.
An observation time of zero means unavailable. The UI does not present it as a real acquisition date.
Every saved entry carries a historical label. The view shows the character, realm, and local receipt time beside the original observation time.
Detail control identifiers include the account, character GUID, session, and record identifier to keep equal record identifiers separate.
Separate flags identify item details, attributes, tooltip completeness, and shortened text.
Tooltip text remains plain text. It can include effects, enchantments, sockets, and set descriptions that the game supplies.
A set description does not establish that its bonus is active. The app does not infer a missing effect or character total.

Only the main character window sends equipment context to chat. Equipment observations do not trigger proactive speech.
Saved history is display-only. Live context still comes from the bridge records for the current character session.
Context contains at most three recent records from the matching character GUID and session.
Each record retains all received numeric attributes and tooltip lines. The protocol limits each record to 8192 UTF-8 bytes.
The context preserves late tooltip lines because these lines can contain effects and set descriptions.
The `contextTruncated` field is false. Addon truncation and incomplete data retain their separate flags.
Only the three latest matching observations enter context. The prompt identifies the omission of older records.
Record JSON stays within 24 KiB, plus array delimiters. The full context stays within 32 KiB, including its fixed instructions.
The original observation time remains in context. Receipt of a repeated frame does not claim that the item was just acquired.
The prompt marks all item text as untrusted game data. A plain JSON block preserves the text without XML delimiters or extra escaping.
Model instructions prohibit actions from item text and assumptions that the character wears an item.
Equipment changes invalidate the context cache even when the character snapshot sequence does not change.
Stale, paused, offline, failed, and disabled connections remove live context. The UI can retain clearly marked historical records.
Retail and Forever use separate context writers. Equal item, character, and session identifiers do not join their records.

## Equipment confirmation results

The addon asks the user about eligible new items with higher item levels or an empty destination slot.
Each change requires a separate confirmation inside the game. AIRI cannot approve or execute a change through chat or a desktop control.
A higher item level does not establish the best attributes, set bonuses, or combat benefit.

The screen decoder publishes terminal results through the optional `equipmentSwaps` list and independent `equipmentSwapError` field.
Published bridges without these fields remain supported permanently for character data and any equipment observations they provide.
An absent result list means unsupported result reporting. It does not prove that no equipment change occurred.
The result schema rejects unknown fields, invalid identities, duplicate session result identifiers, invalid bounds, and conflicting status and reason pairs.
Each result identifies the character, session, original equipment observation, new item, old item, target slot, outcome, reason, and original time.
The result identifier is independent from the equipment observation identifier.

Each version displays up to ten results for the matching character and session.
A name requires matching session, character, equipment observation identifier, and item identifier. Otherwise, the view shows the item identifier.
The interface distinguishes a declined request, an expired question, a confirmed change, and an unconfirmed result.
An expired question did not execute a change. A failed result with a timeout leaves the actual equipment outcome unknown.
The interface tells the user to inspect the game equipment panel after an execution timeout.
The records describe past actions. They do not establish the current equipment layout.
The display retains historical results with a clear label while capture or result data is unavailable.

Only live, online screen observations without capture or result errors supply result context.
The context includes the latest three matching results and treats item names as untrusted data.
It prohibits remote execution, assumptions about current wear, and claims that an execution timeout proves no change occurred.
A result update invalidates the context cache even when the character snapshot sequence stays unchanged.
Result observations never trigger proactive chat or speech. Existing game event reactions retain their own policy.

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
3. Open **Settings → WoW Companion**, then select Retail or Forever.
4. Enable the connection for the selected game.
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
For a port conflict, identify the process on that profile's port before you stop it.
After you correct the error, wait for the retry or disable and enable the connection.

The decoder uses physical desktop pixels. Window borders and additional monitors change the capture origin.
A minimized, covered, or frozen grid cannot supply fresh observations.
Event history records observations. A recorded event does not mean that the model replied or audio played.

## Equipment upgrade prompts

The game publishes one current equipment confirmation as a bounded `offer` frame.
An offer requires higher item level or an empty slot. It does not calculate set, enchantment, secondary-stat, or special-effect benefits.
The frame includes the character, session, equipment observation, sequence, target slot, item levels, name, and expiration.
The sequence orders ready and closed transitions. The bridge rejects stale sequences without refreshing the character heartbeat.
Offers share the existing grid. The game publishes a closed offer when the confirmation stops being available.

The main desktop character window owns one equipment prompt across both game profiles.
It reads fixed localized text through the configured speech output. It makes no chat-model request.
Missing voice configuration, muting, and speech failure retain the text prompt.
Standalone speech owns a fresh interaction trace and closes it after output settles. It never consumes a pending composer or voice-input parent.
The choices appear after owned playback drains. Text-only prompts show the choices immediately.
The player has ten seconds to choose. Decline and timeout dismiss the desktop prompt.
Accept shows instructions to click the game confirmation. The desktop does not send keys, commands, or equipment actions.
The game confirmation remains the execution boundary. The addon rechecks the item and slot before it changes equipment.
Desktop dismissal does not dismiss the game dialog. The game dialog expires within the candidate's original 120-second lifetime.

Disconnect, expiration, combat, death, and character changes invalidate the desktop prompt and cancel its owned speech.
Normal speech captions cannot clear the equipment prompt or its choices.

## Desktop speech captions

The desktop character window shows a caption bubble for actual speech playback.
The shared Stage emits `speechCaption` text through a Vue event. The desktop page owns the bubble presentation.
Normal chat and companion notifications use the same speech output callbacks.
The bubble shows the latest audio segment text. An empty text segment preserves the previous caption only within the same response.

The playback caption owner tracks response identity and started audio clips.
A response can close before cancelled audio finishes its fade. The hide timer waits for both response closure and clip completion.
The bubble remains visible between sentences. It clears three seconds after the whole response finishes playback.
Muting closes the caption response. The delay starts after audio stops, even if the model continues generating text.
New playback cancels the previous hide timer. Late completion callbacks cannot clear the caption of another response.
Silent text generation does not show a speech caption. Scene teardown clears captions and timers.

The bubble accepts plain text and ignores pointer events. Its painted surface is excluded from desktop ambient-light sampling.
An unusually long audio segment can exceed a very short character window. Enlarge the window to read more text.
This feature adds no model requests, speech requests, or game event triggers.

## Checks

Caption tests cover playback timing, sentence gaps, interruption, muting, empty segments, session isolation, and scene teardown.
Bubble browser tests cover narrow windows, color modes, text safety, pointer passthrough, action buttons, and ambient-light masks.
Equipment prompt tests cover voice fallback, playback completion, ten-second choices, invalidation, and late callbacks.
The policy tests cover baselines, decoder restarts, identity changes, stale capture, demo isolation, combat delay, cooldown, and input validation.
HTTP tests cover request ordering, failed commands, and the real Python service contract.
Equipment tests cover field limits, unknown values, context bounds, untrusted text, session isolation, stale data, and both version pages.
History view tests cover ten-record order, offline visibility, distinct character controls, full details, text safety, storage errors, and unchanged chat behavior.
Confirmation tests cover strict results, unsupported sources, matching item names, timeout meanings, same-sequence context changes, and no proactive replies.
Gold tests cover cumulative differences, reloads, character and account grouping, exact totals, storage recovery, and invalid observations.
Lifecycle tests cover automatic startup, external service reuse, retry delays, owned child cleanup, and parent pipe closure.
Profile tests cover explicit IPC routing, file isolation, shared account identifiers, disabled defaults, and invalid game keys.
HTTP and lifecycle tests reject bridges from the other game and keep separate capture files.
Run the desktop typecheck and targeted Vitest tests before a release.
