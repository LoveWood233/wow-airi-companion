# WoW Companion: WCP1 / WCF1 frames, snapshot version 3

The addon publishes a bounded snapshot through a visible black-and-white grid. The desktop bridge reads the grid without accessing game process memory.

## Current map coordinates (2.12.0)

Retail addon 2.12.0 and Forever addon 1.9.0 add `px` and `py` to character snapshots. Bridge 2.12.0 reads these fields.

This is an additive part of the supported v3 contract. The frame stays 512 bytes, and the payload stays within 504 bytes.

| Field | Contract |
| --- | --- |
| `px`, `py` | Paired integers from 0 through 10000, or paired JSON `null` |
| `map` | The UI map ID that defines these coordinates |

Each integer represents a map fraction multiplied by 10000. For example, `px:1234, py:5678` means map coordinates `12.34, 56.78`.

Both fields absent is also a valid v3 snapshot with unknown coordinates. A single missing field or mixed numeric/null pair is invalid.

The addon reads the player's best map and public `C_Map.GetPlayerMapPosition` result. It samples movement on the existing one-second heartbeat.

Unavailable, restricted, invalid, offline, and map-zero observations clear both values. The addon does not reuse coordinates from another map.

The bridge validates the pair before publication. Offline and map-zero observations publish unknown coordinates.

The status endpoint also clears coordinates when the displayed observation becomes stale. Historical event facts retain their original observations.

The desktop displays coordinates only for a fresh, live, online screen observation without capture errors. Unknown coordinates stay unknown in chat.

These are map coordinates. They do not establish world-space distance, elevation, a walkable route, or precise capture time.

Coordinate changes advance the snapshot sequence. They do not create proactive companion events or change idle interaction rules.

The grid remains 64 by 64 pixels at the default cell size. Display labels still shrink before required numeric data is discarded.

API definitions: [Blizzard MapDocumentation](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/MapDocumentation.lua) and [Vector2DMixin](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_SharedXML/Vector2D.lua).

## Compact grid (2.11.1)

Retail addon 2.10.1 and Forever addon 1.7.1 use one physical pixel per bit by default. The complete frame occupies 64 by 64 pixels.

The first updated addon load changes the stored cell size to one. Position and telemetry settings remain unchanged.

A migration marker preserves later user choices, including larger cells. The `compact` addon command selects one-pixel cells again.

Bridge 2.11.1 also uses one-pixel cells by default. It can detect the compact grid near a configured larger-cell origin.

This detection does not change the stored calibration. CRC, frame validation, and gray-pixel rejection still apply.

Frame bytes, field bounds, fragment scheduling, and heartbeat rules do not change.

## Current equipped inventory (2.11.0)

Retail addon 2.10.0 and Forever addon 1.7.0 publish a separate full equipment snapshot. The desktop requires bridge 2.11 or later.

Login, a real equipment acquisition, and an equipment change request a fresh collection. A manual acquisition comparison does not fabricate an acquisition.

The addon reads all slots from 1 through 19. It retries public item data loads for a bounded period.

Each slot has one state. `equipped` contains an item. `empty` and `unknown` contain JSON `null`.

Only a public negative item-existence result establishes an empty slot. A restricted read remains unknown.

The snapshot body contains these exact fields:

| Field | Contract |
| --- | --- |
| `v` | Integer `1` |
| `id` | Positive session-local equipment revision, independent of acquisition IDs |
| `session`, `guid` | Current character session and GUID, matching the fragment headers |
| `observedAt` | Observation time in Unix seconds. Zero means unavailable |
| `reason` | `login`, `equipment_acquired`, `equipment_changed`, or `refresh` |
| `slots` | Exactly 19 ordered, unique entries for slots 1 through 19 |

Each slot contains `slot`, `state`, and `item`. An equipped item contains these exact fields:

`itemID`, `itemGUID`, `link`, `name`, `type`, `subtype`, `equipLoc`, `quality`, `itemLevel`, `requiredLevel`,
`stats`, `tooltip`, `infoComplete`, `statsComplete`, `tooltipComplete`, and `truncated`.

The instance link preserves the observed item variant. Public statistics and tooltip lines describe that instance, not character-wide totals.

Items retain the acquisition codec's bounds: 32 statistics, 48 tooltip lines, 256 UTF-8 bytes per line, and 8192 JSON bytes per item.

Each snapshot has a 196608-byte body limit. Cropped details set the truncation flag and clear the affected completeness flag.

The fragment envelope is `{v:1,kind:"gear",s,g,id,p,n,d}`. It uses 240-byte raw chunks with canonical Base64, like acquisition fragments.

A snapshot uses at most 820 fragments. The decoder allows 1200 seconds for assembly and retains at most two pending revisions.

The receiver matches session, GUID, revision, fragment count, and complete body identity. It rejects conflicting or stale revisions.

CRC, JSON validation, and field validation apply before publication. The receiver replaces all 19 slots together after successful assembly.

Equipment frames do not advance the character heartbeat. Character changes, session changes, and demo transitions clear the bridge's current equipment.

Fresh comparisons and equipment offers retain transmission priority. The full snapshot receives background capacity before old acquisition and comparison replays.

The HTTP status adds required fields `equipmentLoadout` and `equipmentLoadoutError`. Both use JSON `null` when no value exists.

The desktop saves snapshots by game profile, local account identifier, and character GUID. This store is separate from the ten-entry acquisition history.

Chat labels saved equipment with observation time and freshness. Unknown slots remain unknown. Set tooltip descriptions do not establish active set bonuses.

Equipment snapshots do not request a proactive chat response. Existing acquisition offers continue to control equipment suggestions.

## Frame

- Grid: 64 columns by 64 rows, in row-major order.
- Default cell size: 1 physical pixel in both game profiles. Default screen position: x=8, y=8 for a game on the primary display.
- Each cell stores one bit. Black is 0. White is 1. Bytes use most-significant bit first.
- Frame size: 512 bytes. The decoder rejects incomplete frames and invalid checksums.

| Offset | Bytes | Meaning |
| --- | --- | --- |
| 0 | 4 | ASCII `WCP1` for Retail, `WCF1` for Forever |
| 4 | 2 | UTF-8 JSON payload length, unsigned little-endian |
| 6 | 2 | CRC16-CCITT of payload, unsigned little-endian |
| 8 | 0–504 | JSON payload, followed by zero padding |

CRC uses initial value `0xffff` and polynomial `0x1021`. Python reference: `binascii.crc_hqx(payload, 0xffff)`.

## Snapshot

```json
{"v":3,"session":"example-session","seq":2,"tick":9,"guid":"Player-example","name":"示例角色","realm":"示例服务器","level":30,"class":"MAGE","faction":"Alliance","race":"人类","spec":64,"map":84,"zone":"暴风城","combat":false,"dead":false,"online":true,"account":"local-example","moneyEpoch":"segment-example","copper":12345,"earned":1000,"spent":250}
```

This example is synthetic. Production frames contain the current character's available data.

- `session` changes on UI reload or a new character session.
- `seq` increases when business state changes.
- `tick` changes once per second, including when the character stands still.
- `guid`, `session`, and the data source isolate each baseline.
- `level` uses the new level supplied by `PLAYER_LEVEL_UP`.
- `class` is the English class token. `spec` and `map` are numeric IDs.
- `zone` is the localized map or zone name.
- `combat`, `dead`, and `online` describe available player state.
- The addon filters secret values before comparison, encoding, or display.
- Text is bounded and truncated at UTF-8 boundaries when required.

All three components require snapshot version 3. Update the addon, bridge, and 魔兽陪伴精灵 together.
Both games use the same layout and snapshot fields. Frame magic identifies the game. Decoders reject the other game’s magic.

## Faction and race (2.7.0)

Both keys are required. An unavailable, restricted, or invalid source value becomes JSON `null`.

| Field | Values and source |
| --- | --- |
| `faction` | `Alliance`, `Horde`, `Neutral`, or `null`. The first return value of `UnitFactionGroup("player")`. |
| `race` | Localized race name from the first return value of `UnitRace("player")`, or `null`. Maximum 48 UTF-8 bytes. |

Consumers reject other faction tokens, non-string race values, control characters, and race names over the byte limit.
Faction is never inferred from race, class, or character name. This also covers races that can join different factions.
Unknown values replace the previous values. A character change cannot retain the previous character's faction or race.

The grid stays 64 × 64. Encoding first shortens the existing display labels to fit the 504-byte payload.
If the payload still does not fit, the complete race value becomes `null`. A partial race name is never transmitted.
Identifiers, gold counters, and faction are preserved exactly. If that minimum payload exceeds 504 bytes, encoding fails instead of corrupting data.
The unrefreshed frame then ages out through the existing heartbeat rules. Extreme combinations of maximum-length identifiers can reach this limit.

魔兽陪伴精灵 displays both fields and includes them in live chat context and event facts.
Event wording follows the active character card, including user-requested fictional faction banter. It does not override mute, cooldown, or combat quiet settings.
The local Sylvanas card permits occasional Horde death banter such as “部落都是废物。” This is an example, not a fixed response.
The model must use the event's actual faction and race, and treat unknown values as unknown.

API definitions: [Retail UnitDocumentation](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/UnitDocumentation.lua) and [Forever UnitDocumentation](https://github.com/Gethe/wow-ui-source/blob/forever/Interface/AddOns/Blizzard_APIDocumentationGenerated/UnitDocumentation.lua).

## Desktop level history (2.8.0)

This desktop feature uses existing snapshot v3 fields. Retail addon 2.7.0, Forever addon 1.4.0, and bridge 2.7.0 remain unchanged.
No new screen field, frame type, or HTTP endpoint is required.

The 魔兽陪伴精灵 main process stores level observations by game profile, local account identifier, and character GUID.
Only valid, live, online screen observations without capture errors enter this history. Demo data does not enter the history.
Each record contains the previous level, observed level, local receipt time, observation source, duration, and duration basis.
Timestamps use `Date.now()` as Unix milliseconds. The settings page displays local dates and times.
Receipt timestamps include the existing capture and polling delay. They are not server-issued achievement timestamps.

The first observation establishes a baseline. It cannot recover earlier level changes.
Consecutive observed upgrades produce a complete duration for one level. That duration is the difference between their receipt timestamps.
Offline periods, character switches, and 魔兽陪伴精灵 downtime between those observations remain part of the duration.
An unchanged level after reconnection preserves the known start time for the next observed upgrade.

The first upgrade after a baseline only measures time since that baseline. The display marks this duration as partial.
If reconnection reveals a changed level, the record marks a gap. Its timestamp records discovery, not the unknown upgrade time.
A jump across multiple levels does not create invented intermediate records or evenly divided durations.
Decreases and clock changes cannot produce negative or complete level durations from invalid intervals.
The history retains all recorded changes. It does not use the ten-record equipment limit.

Retail saves `wow-companion-level-history-v1.json` in the 魔兽陪伴精灵 user data directory.
Forever saves `wow-companion-forever-level-history-v1.json` in the same directory.
Each profile owns its file, and each account and GUID owns separate records within that file.
Atomic replacement protects completed saves. Invalid files remain untouched, and the settings page displays the storage error.
魔兽陪伴精灵 flushes pending writes during normal exit. Saved records remain available while the game is offline.

This feature makes no model requests and adds no speech trigger. Reminder preferences and notification cooldowns retain their existing behavior.

## Equipment comparison observations (desktop and bridge 2.9.0)

Retail addon 2.8.0 and Forever addon 1.5.0 add a separate comparison stream. Snapshot v3, equipment observations, and frame size remain unchanged.
Update the addon, bridge, and desktop together. 魔兽陪伴精灵 requires bridge 2.9 or later for this feature.

A `cmp` fragment uses the existing 512-byte frame and 504-byte payload limit:

```json
{"v":1,"kind":"cmp","s":"session","g":"Player-1","id":1,"p":1,"n":2,"d":"base64"}
```

Parts carry at most 240 decoded bytes. A comparison contains at most 4096 bytes across at most 18 parts.
The bridge isolates comparison reassembly, errors, deduplication, and byte budgets from equipment observations.
A comparison never refreshes the character heartbeat. Session and character changes clear the live comparison cache.

The comparison body has these required fields:

| Field | Meaning |
| --- | --- |
| `v`, `id`, `session`, `guid` | Version 1 and the matching equipment acquisition identity. |
| `class`, `spec`, `primary` | Observed class and specialization. Primary stat is 1 for strength, 2 for agility, 4 for intellect, or 0 for unknown. |
| `observedAt` | Original game observation time in Unix seconds. Zero means unknown. |
| `slot` | Target equipment slot, or 0 when no target is available. |
| `usable`, `specMatch` | Observed usability and specialization match. An unavailable specialization match is `null`. |
| `current`, `candidate` | Equipment attributes at comparison time. `current=null` accompanies an unavailable target slot. |

Each item contains `itemID`, `name`, `itemLevel`, `equipLoc`, `type`, `subtype`, `stats`, `complex`, and `complete`.
Item labels use at most 128 UTF-8 bytes. Stats retain at most 32 unique keys and finite values.
An empty slot uses `itemID=0`, `itemLevel=-1`, and an empty stats array.
Unknown or restricted item values cannot prove an upgrade. Oversized comparisons are rejected without truncating the evidence.

The API exposes `equipmentComparisons` and `equipmentComparisonError`. It retains the ten latest live comparison records.
魔兽陪伴精灵 independently evaluates the received evidence. It stores ten comparison observations per game in separate user-data files:
`wow-companion-equipment-comparisons-v1.json` and `wow-companion-forever-equipment-comparisons-v1.json`.
Acquisition ID, character GUID, session, and account correlate a saved comparison with an equipment history entry.
These records describe equipment at observation time. They are not a continuously updated snapshot of all equipped slots.

### Decision rules

Only a clear upgrade can produce a desktop equipment question or enter the game confirmation queue.
The candidate must be usable, match the active specialization, and have complete comparison data.
A comparable item keeps the equipment type and slot layout. Recognized quantitative stats for the active specialization cannot decrease, and at least one must increase.
Only the active primary stat participates. Other specialization primary stats do not contribute.
Item level cannot decrease. A higher item level alone does not prove an upgrade. Equal item levels can still qualify through better stats.
An available empty slot can qualify. Unknown data, stat tradeoffs, complex effects, sets, sockets, and enchantments require manual review.
Items that do not suit the specialization, or have only stat losses, do not trigger an upgrade question.
The implementation does not translate a stat difference into a claimed damage or healing percentage.

The desktop also requires a matching, live, unexpired game offer. Character, session, class, specialization, slot, and both item identities must agree.
A missing comparison never falls back to item level alone. Spec changes, stale capture, and changed offers cancel the question.
The game repeats its comparison and slot checks when the player clicks the confirmation.
Desktop Yes remains a request to return to the game confirmation. It does not send a game command or simulated input.
Voice availability controls speech output. Text and ten-second Yes/No choices remain available without speech.

API definitions: [Retail item APIs](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/ItemDocumentation.lua), [Retail specialization APIs](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/SpecializationInfoDocumentation.lua), and the corresponding [Forever item](https://github.com/Gethe/wow-ui-source/blob/forever/Interface/AddOns/Blizzard_APIDocumentationGenerated/ItemDocumentation.lua) and [specialization](https://github.com/Gethe/wow-ui-source/blob/forever/Interface/AddOns/Blizzard_APIDocumentationGenerated/SpecializationInfoDocumentation.lua) definitions.

## Gold counters

All source amounts use integer copper. One gold equals 10,000 copper. One silver equals 100 copper.

| Field | Meaning |
| --- | --- |
| `account` | Persistent local account identifier matching `[A-Za-z0-9_-]{1,40}`. It contains no Battle.net login information. |
| `moneyEpoch` | Persistent character counter segment matching `[A-Za-z0-9_-]{1,40}`. Reloads retain the segment. |
| `copper` | Current character wallet, or `null` while unavailable. |
| `earned` | Cumulative wallet increases observed by the addon in this segment. |
| `spent` | Cumulative wallet decreases observed by the addon in this segment. |

Numeric amounts range from 0 through 9,007,199,254,740,991. The addon creates a segment for a new or invalid character record, and starts another segment on counter overflow.
The addon samples `GetMoney()` on `PLAYER_MONEY`. The first sample sets the balance baseline without counting existing gold as income.
Each subsequent change updates one counter. Gains and losses between screen captures remain separate.
After a reload or unavailable value, a fresh balance baseline prevents invented transactions across the gap.

魔兽陪伴精灵 imports these cumulative counters only from live, online screen snapshots without a capture error.
Account, character GUID, and counter segment identify each record. Repeated frames and session changes do not add the counters again.
For the same segment, lower counters are rejected. Retired segments cannot replace a newer segment.
Restoring an older SavedVariables file can lower these counters. Both source counters must catch up before that character resumes ledger updates.
Desktop totals use exact integers and cross IPC as decimal copper strings. Gold, silver, and copper formatting happens at display time.

The account identifier belongs to the account-wide SavedVariables file. It does not identify a Battle.net account independently of that file.
Characters that share this file share the account group. 魔兽陪伴精灵 stores an optional display name for each group.
Clearing this file creates a new identity. Copying it across unrelated accounts also copies that identity.

Totals describe wallet flows, including mail, trades, repairs, purchases, and bank transfers.
They exclude separate warband and guild bank balances. Account balance sums the last known wallets of observed characters.
It is not a simultaneous measurement of every character. Transfers between owned characters appear as both inflow and outflow.
The protocol carries no transaction category or transaction timestamp. It cannot reconstruct activity that the addon did not observe.

## Freshness and events

The bridge rejects bad magic, version, length, JSON shape, and CRC. A repeated frame does not refresh its heartbeat timestamp.

A heartbeat older than five seconds marks the source stale. Stale data remains visible as historical state. It cannot trigger live notifications.

The first valid snapshot establishes a baseline. A new character, session, data source, or recovery after a gap establishes a new baseline.

The bridge derives changes from successive valid snapshots. This protocol does not provide a lossless queue of every game event.
Gold counters preserve observed cumulative flows during capture gaps. They do not preserve individual transaction times or descriptions.

The 魔兽陪伴精灵 integration consumes bridge events once. It applies reminder preferences, combat quiet mode, and cooldown before requesting a character reaction.

## HTTP boundary

Retail binds to `127.0.0.1:18765`. Forever binds to `127.0.0.1:18766`. Each game uses a separate process. The 魔兽陪伴精灵 main process calls its local HTTP API. 魔兽陪伴精灵 main-to-renderer messages use Eventa.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Service health |
| GET | `/api/status` | Status, snapshot, recent events, and capture settings |
| GET | `/api/events?after=0` | Events after a cursor |
| GET | `/api/frame.bmp` | Capture preview |
| POST | `/api/config` | Capture rectangle, cell size, polling interval, and pause state |
| POST | `/api/demo` | Explicitly enable or disable synthetic events |

Browser origins are restricted to local development and the 魔兽陪伴精灵 app. Write requests require JSON and an accepted origin when an Origin header is present.

## SavedVariables

`WoWMapCompanionDB` (Retail) and `WoWForeverCompanionDB` (Forever) preserve settings, the last snapshot, the local account identifier, and character gold counters.
WoW writes this data on reload or logout. It is not the real-time transport.
An abrupt game exit before saving can lose recent source counters.

魔兽陪伴精灵 stores its account ledger in its local user data directory. Atomic file replacement protects completed saves.
An invalid ledger file is preserved. 魔兽陪伴精灵 reports the error and stops ingestion instead of overwriting it.
Demo observations never enter the ledger.

## Capture conditions

The grid must be visible and fully captured. Window position, monitor arrangement, UI scale, display scaling, HDR, and overlays can affect capture.

Calibrate the bridge coordinates against the visible grid. Keep the game in windowed or borderless mode during initial setup.

The bridge reports waiting or stale when capture fails. Demo mode always uses a separate label and baseline.

## Game profiles (2.3.0)

`--game retail|forever` selects a fixed protocol, default port, and default capture configuration file.
Retail retains `bridge-config.json`. Forever uses `bridge-config-forever.json` and defaults to cell size 1.
HTTP health and status responses include `game` and `protocol`. Capture updates cannot change the game.

魔兽陪伴精灵 uses explicit game keys in IPC requests. Each game owns its settings, client, runtime, event cursor, notification policy, and ledger.
Retail retains its original files. Forever uses `wow-companion-forever-v1.json` and `wow-companion-forever-gold-v1.json` in 魔兽陪伴精灵 user data.
Both profiles share the configured model and voice providers. Forever starts disabled until the user enables it.
Matching account IDs and character GUIDs across games never merge their ledgers.

Forever addon 1.0.0 targets the published 1.60.x / Interface 16001 baseline.
An unsupported client reports an error without publishing telemetry. Encoding self-tests do not certify client compatibility.
No Forever client was available for this delivery. API compatibility and capture need verification after client download.

## Equipment extension (2.4.0)

The grid size and frame magic stay unchanged. Each frame contains either the supported v3 snapshot or one equipment fragment.
The addon alternates status and equipment frames. Each frame stays visible for one second. Capture uses a 250–500 ms interval.
Equipment frames do not refresh the status heartbeat. The decoder requires a current, online screen snapshot from the same character and session.

```json
{"v":1,"kind":"eq","s":"session","g":"Player-example","id":1,"p":1,"n":2,"d":"base64 bytes"}
```

`s` and `g` use ASCII letters, digits, underscores, and hyphens. Their limits are 40 and 48 bytes.
`id` ranges from 1 through 2,147,483,647. `p` is a one-based part number. `n` ranges from 1 through 35.
Each nonfinal part contains 240 raw bytes. The final part contains 1–240 bytes. Base64 wraps those bytes inside JSON.
The complete UTF-8 JSON body is at most 8,192 bytes. A fragment can split a UTF-8 character between its bytes.
The decoder joins raw bytes before UTF-8 decoding. Each frame retains its original CRC16 check.

| Complete record field | Meaning |
| --- | --- |
| `v`, `id`, `session`, `guid` | Version 1 and identity. The identity must match the fragment envelope. |
| `source`, `observedAt`, `quantity` | `bag_added`, game server time in seconds, and newly observed quantity. |
| `itemID`, `itemGUID`, `link` | Item ID, optional instance GUID, and exact instance hyperlink. |
| `name`, `type`, `subtype`, `equipLoc` | Public item metadata, or null when unavailable. |
| `quality`, `itemLevel`, `requiredLevel` | Public numeric metadata, or null when unavailable. |
| `stats` | Up to 32 `{key,value}` entries from the public stats API. |
| `tooltip` | Up to 48 public tooltip lines, at most 256 UTF-8 bytes per line. |
| `infoComplete`, `statsComplete`, `tooltipComplete` | Whether each source supplied all readable values within the local limits. |
| `truncated` | Whether the addon removed content to obey limits. |

The hyperlink limit is 1,024 UTF-8 bytes. Other text fields allow 128 bytes. Stat keys allow 64 bytes.
Missing metadata stays null. Empty stats do not prove that an item has no bonuses.
Tooltip text includes displayed affixes, enchants, sockets, effects, and set descriptions when the client supplies them.
A set description does not prove that its effect is active. This extension does not calculate damage, proc chance, or equipment upgrades.

The addon records newly observed equipment in carried bags. Initial inventory and equipped items form the baseline.
Bag sorting and equip changes do not create new records. A bank withdrawal, mail, trade, or purchase can create a bag addition.
The record does not identify a loot source. A GUID supplies instance identity. Without a GUID, link counts use conservative deduplication.
Initial loading, restricted fields, rapid item removal, capture gaps, or a full queue can prevent a record.

The addon retains at most six recent records for ten minutes in the current session.
Without swap results, first transmission takes roughly two seconds per fragment, plus queue and item-loading time.
Swap result frames can extend a 35-fragment transmission from about 70 seconds to about 94 seconds.
Concurrent offer and swap frames extend the upper bound to about 140 seconds, before queueing or retransmission.
Repeated frames allow recovery from missed captures. There is no acknowledgment channel or lossless delivery guarantee.
The bridge bounds incomplete records by count, length, and timeout. Conflicting fragments cannot replace a valid record.
Pausing, capture changes, character changes, and demo switches clear equipment assembly state.

HTTP status adds `equipment`, an array of at most ten complete records, and `equipmentError` for independent equipment diagnostics.
Older bridge releases without these fields remain a supported status-only source. They cannot decode equipment frames.
Update the addon, bridge, and 魔兽陪伴精灵 together before equipment use.
魔兽陪伴精灵 shows recent records and includes bounded equipment data in chat context. It treats all item text as untrusted observations.
Equipment does not trigger an automatic spoken notification. Demo data never enters the real equipment list or gold ledger.

## Confirmed equipment swaps (2.5.0)

The addon asks the player inside the game. Only the acceptance button starts an equipment action.
Desktop chat, voice replies, and screen frames cannot accept an equipment proposal. The pixel transport remains game-to-desktop.
Macro import uses a separate desktop input workflow described below. It cannot accept an equipment proposal.
The addon checks the exact item instance and destination again before the action.
It reports success only after it observes the candidate GUID in the intended equipment slot.
Native binding, refund, and trade confirmation dialogs remain under player control.

Swap results use an independent single frame. They do not change the equipment record schema or the grid size.

```json
{"v":1,"kind":"swap","s":"session-1","g":"Player-1-ABC","id":1,"e":3,"st":"equipped","r":"confirmed","at":1792800000,"slot":1,"item":12345,"old":67890}
```

All fields are required. Unknown fields are rejected.

| Field | Meaning and bounds |
| --- | --- |
| `v`, `kind` | `1` and `swap`. |
| `s`, `g` | Session and player GUID. ASCII letters, digits, underscore, and hyphen. Maximum lengths are 40 and 48 bytes. |
| `id` | Result sequence for this session. Integer from 1 through 2,147,483,647. |
| `e` | Original equipment observation ID, with the same integer bounds. |
| `st` | `equipped`, `declined`, `failed`, or `expired`. |
| `r` | A fixed reason code from the table below. |
| `at` | Original result time in Unix seconds, from 0 through 4,102,444,800. Zero means unavailable. |
| `slot` | Target inventory slot, from 1 through 19. |
| `item`, `old` | New and previous item IDs. Maximum 2,147,483,647. New IDs start at 1. Zero means an empty previous slot. |

| Result | Valid reasons |
| --- | --- |
| `equipped` | `confirmed` |
| `declined` | `user` |
| `expired` | `timeout` |
| `failed` | `timeout`, `combat`, `changed`, `unavailable`, `locked`, `cursor`, `dead`, `restricted`, `disabled`, `left_world` |

The addon retains ten results for ten minutes and repeats them through the existing grid.
New results receive their first broadcast before older results are replayed.
With equipment fragments present, at most one of every four remaining data slots carries a swap result.
Offers take one of every three data slots first.
A new result normally reaches its next slot within eight seconds without offers, or twelve seconds with offers. Bursts can queue longer.
Normal status frames still appear at least every two seconds. Swap frames never refresh the bridge heartbeat.

HTTP status adds `equipmentSwaps` and `equipmentSwapError`.
The bridge accepts results only for the current live, online screen session and retains ten results in ID order.
Repeated IDs are deduplicated. Conflicting payloads for the same ID produce an independent swap error.
The same reset boundaries as equipment observations apply to swap results.
Older bridges without these fields remain supported for their existing telemetry features.

魔兽陪伴精灵 shows the latest results and includes three matching results in live chat context.
An `equipped` result proves a past confirmed action, not that the item remains equipped now.
Swap results do not trigger automatic model calls, voice replies, or gameplay actions.

## 魔兽陪伴精灵 equipment history (desktop 2.5.1)

魔兽陪伴精灵 saves complete equipment observations in its local user data directory.
Each game profile retains ten records across characters. New records replace the oldest records by receipt order.
Each entry includes the character name, realm, account identifier, receipt time, and original equipment record.
Repeated observations do not change the order or add another entry.
The history survives application restarts, lost connections, and character changes.
Only matching live screen observations enter the history. Demo observations do not enter it.
The files are `wow-companion-equipment-history-v1.json` and `wow-companion-forever-equipment-history-v1.json`.
At most 512 identity hashes prevent recent duplicates after discarded records or desktop restarts. These hashes contain no equipment details.

The desktop IPC state adds `equipmentHistory`, with `entries` and `storageError`.
This field does not change the screen protocol or the bridge HTTP response.
History entries are past observations. They do not prove current ownership or equipment slots.
Chat context continues to use current bridge observations. Saved history does not trigger speech or equipment actions.


## Equipment offers (2.6.0)

A single `kind=offer` frame describes the current game confirmation. It never requests a desktop game action.

Fields: `v=1`, `kind=offer`, session `s`, character `g`, equipment observation `id`, monotonic publication sequence `q`, state `st` (`ready` or `closed`), slot `slot`, new item ID `item`, plain name `n` (1–96 UTF-8 bytes), new item level `il`, old item ID `old` (0 for empty), old item level `ol` (-1 for empty), and server expiration `until` in seconds.

Item and sequence IDs range from 1 through 2147483647. Slots range from 1 through 19. Item levels range from 0 through 100000, except the empty-slot sentinel. A nonempty slot requires `il > ol`. The candidate expires within 120 seconds of creation.

The bridge orders states by `q` within the current character session. Status exposes closed states until expiry so the desktop can dismiss its prompt. After expiry, the bridge retains the last value internally to reject older frames. Duplicate frames do not refresh the heartbeat or expiry. Status adds optional `equipmentOffer` and `equipmentOfferError`. Only live screen observations expose an unexpired offer. Older bridges without this extension remain supported for existing features.

The desktop reads fixed localized text through the configured voice. With no voice, muting, or voice failure, it shows text. After playback drains, it shows Yes and No thanks for ten seconds. Yes instructs the player to confirm in game. Decline and timeout only dismiss the desktop prompt. Equipment offers do not add keyboard input, game commands, or reverse transport.

## Macro import receipts (bridge 2.13.0)

The optional WoWMacroImport addon reports `v=1`, `kind=macro`, session `s`, GUID `g`, and increasing publication serial `q`.
It also reports request `id` (empty or 32 lowercase hexadecimal characters), state `st`, reason `r`, body `hash`, and UTF-8 `bytes`.
Booleans `focus`, `input`, `chat`, and `combat` describe the import editor, any keyboard focus, the standard chat editor, and combat lockdown.
States are `idle`, `ready`, `edited`, `saved`, `error`, and `closed`.
The hash starts at 5381. For each UTF-8 byte, apply `(hash * 33 + byte) % 4294967296`.
Body normalization converts CRLF and CR into LF and removes leading and trailing ASCII whitespace.

Each companion addon allocates one in two data slots to these receipts when the importer exists.
Normal state slots remain unchanged. No receipt refreshes the character heartbeat.
The bridge accepts only increasing serials for the current live session and GUID.
It exposes a receipt for less than 2.5 seconds after its last new serial, with no capture error, pause, or demo state.
Identity and capture configuration changes clear receipts.

The desktop uses an independent native input helper to open `/import-marco <id>`, paste text, and submit with Ctrl+Enter.
It requires a verified game window, live combat state, matching editor receipts, and a saved-body readback.
This adds no game-to-desktop command endpoint and does not execute the saved macro.
