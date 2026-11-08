# Connection recovery and reception diagnostics

Status: Accepted

Date: 2026-10-31

## Scope

The user approved window tracking, local grid recovery, evidence-based connection causes, fragment progress, and an explicit retry action.
Bridge 2.15.0 adds `window.py` and `connection.py` without changing the addon wire protocols.
Both files are included in resource checks and packaging inputs.

## Window and calibration authority

Native discovery checks the executable name, version directory, HWND, PID, and process creation time.
The selected window remains stable while its identity is valid.
Multiple matching windows without an existing selection block automatic selection.
Missing-window discovery has a one-second backoff. Explicit retry clears that backoff.

Capture validates the same window before and after reading pixels.
Only the requested local region intersecting the verified client is captured.
Padding outside the client is synthetic black. Desktop-wide scanning is not used.
Recovery tries projected sampling, the manual origin, and a client-relative origin within bounded local searches.
Unusual layouts still require correcting the manual origin.

Moves, resizes, process replacement, restart, and retry require three advancing heartbeats from one character session.
CRC validation and profile-specific protocol validation remain mandatory.
Repeated frozen frames and fragment packets cannot establish heartbeat confirmation.
Expired or unconfirmed reception cannot refresh the live character view.

Confirmed sampling is saved atomically beside the manual configuration:

- `bridge-config.json.calibration.json`
- `bridge-config-forever.json.calibration.json`

These files contain only the game, manual configuration basis, relative position, client size, and sampling parameters.
They contain no image, character content, or process path.
The manual configuration remains independent. Changing its origin invalidates an unrelated saved calibration.
A failed save leaves the previous file intact.
The commit guard orders calibration writes against configuration changes, demo changes, pauses, and explicit retries.
Restart loads sampling metadata but never restores old heartbeat confirmation.

## Receiver progress

`/api/status` reports optional diagnostic capabilities separately from character observations.
Sources without this capability still supply their existing observations.
The UI shows window causes, confirmation count, valid-frame time, heartbeat time, retry delay, and last confirmed position.
Unreadable pixels prompt checks for addon visibility, occlusion, and calibration. They do not prove an addon is absent.
Known bridge causes render through local translations instead of raw cause codes.

Fragment progress covers acquired equipment, comparisons, equipped-item snapshots, and calendar data.
Counts come from validated unique parts in existing bounded receiver queues.
Duplicate or replayed part counts cannot rewrite completed progress.
Existing equipment timeouts remain 180 seconds. Equipped-item snapshots retain their 1200-second timeout.
Incomplete calendar reception also expires after 180 seconds.
Completion is independent from character freshness.

## Retry and lifecycle

The UI sends the selected profile through Eventa, then the fixed `/api/reconnect` endpoint.
The endpoint accepts only an empty JSON object.
It discards incomplete reception, invalidates in-flight capture, and establishes a new heartbeat baseline.
Saved desktop history and previous calibration remain available.
Temporary current data follows the existing baseline reset policy and is received again.
The request cannot force addon retransmission. It waits for subsequent addon broadcasts.
The acknowledgement reports that recovery started, never that calibration already succeeded.
Disabled connections, demo mode, and paused capture do not enable retry.

## Validation boundary

Tests use synthetic windows, real codecs, temporary files, loopback HTTP, and real browser components.
They do not launch or operate the user's game, install addons, or send model or speech requests.
Real client and audio acceptance remains excluded as requested.
Managed bridges reload on companion restart. Independently launched bridges require their own restart.
