# WoW Companion: WCP1 frame, snapshot version 2

The addon publishes a bounded snapshot through a visible black-and-white grid. The desktop bridge reads the grid without accessing game process memory.

## Frame

- Grid: 64 columns by 64 rows, in row-major order.
- Default cell size: 2 physical pixels. Default screen position: x=8, y=8 for a game on the primary display.
- Each cell stores one bit. Black is 0. White is 1. Bytes use most-significant bit first.
- Frame size: 512 bytes. The decoder rejects incomplete frames and invalid checksums.

| Offset | Bytes | Meaning |
| --- | --- | --- |
| 0 | 4 | ASCII `WCP1` |
| 4 | 2 | UTF-8 JSON payload length, unsigned little-endian |
| 6 | 2 | CRC16-CCITT of payload, unsigned little-endian |
| 8 | 0–504 | JSON payload, followed by zero padding |

CRC uses initial value `0xffff` and polynomial `0x1021`. Python reference: `binascii.crc_hqx(payload, 0xffff)`.

## Snapshot

```json
{"v":2,"session":"example-session","seq":2,"tick":9,"guid":"Player-example","name":"示例角色","realm":"示例服务器","level":30,"class":"MAGE","spec":64,"map":84,"zone":"暴风城","combat":false,"dead":false,"online":true,"account":"local-example","moneyEpoch":"segment-example","copper":12345,"earned":1000,"spent":250}
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

All three components require snapshot version 2. Update the addon, bridge, and AIRI together.
The grid size and WCP1 frame header do not change.

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

AIRI imports these cumulative counters only from live, online screen snapshots without a capture error.
Account, character GUID, and counter segment identify each record. Repeated frames and session changes do not add the counters again.
For the same segment, lower counters are rejected. Retired segments cannot replace a newer segment.
Restoring an older SavedVariables file can lower these counters. Both source counters must catch up before that character resumes ledger updates.
Desktop totals use exact integers and cross IPC as decimal copper strings. Gold, silver, and copper formatting happens at display time.

The account identifier belongs to the account-wide SavedVariables file. It does not identify a Battle.net account independently of that file.
Characters that share this file share the account group. AIRI stores an optional display name for each group.
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

The AIRI integration consumes bridge events once. It applies reminder preferences, combat quiet mode, and cooldown before requesting a character reaction.

## HTTP boundary

The bridge binds to `127.0.0.1:18765`. The AIRI main process calls its local HTTP API. AIRI main-to-renderer messages use Eventa.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Service health |
| GET | `/api/status` | Status, snapshot, recent events, and capture settings |
| GET | `/api/events?after=0` | Events after a cursor |
| GET | `/api/frame.bmp` | Capture preview |
| POST | `/api/config` | Capture rectangle, cell size, polling interval, and pause state |
| POST | `/api/demo` | Explicitly enable or disable synthetic events |

Browser origins are restricted to local development and the AIRI app. Write requests require JSON and an accepted origin when an Origin header is present.

## SavedVariables

`WoWMapCompanionDB` preserves settings, the last snapshot, the local account identifier, and character gold counters.
WoW writes this data on reload or logout. It is not the real-time transport.
An abrupt game exit before saving can lose recent source counters.

AIRI stores its account ledger in its local user data directory. Atomic file replacement protects completed saves.
An invalid ledger file is preserved. AIRI reports the error and stops ingestion instead of overwriting it.
Demo observations never enter the ledger.

## Capture conditions

The grid must be visible and fully captured. Window position, monitor arrangement, UI scale, display scaling, HDR, and overlays can affect capture.

Calibrate the bridge coordinates against the visible grid. Keep the game in windowed or borderless mode during initial setup.

The bridge reports waiting or stale when capture fails. Demo mode always uses a separate label and baseline.
