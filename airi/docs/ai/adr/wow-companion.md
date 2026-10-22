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
The page provides calibration, reminder preferences, a clearly marked demo, and recent game events.
Chat, character animation, and speech use the existing AIRI configuration.

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
Run the desktop typecheck and targeted Vitest tests before a release.
