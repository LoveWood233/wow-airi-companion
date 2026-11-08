# 魔兽陪伴精灵 desktop app

The Electron app combines AIRI characters, conversation, voice, and Warcraft companionship for Retail and WoW Infinite (魔兽世界：无限).
The Infinite profile retains the internal identifier `forever` and the English settings label **World of Warcraft: Forever**.
Shared character behavior belongs in `packages/stage-ui`. Use `stage-web` for browser-only features.

The current companion release contains these versions:

| Component | Version |
| --- | --- |
| Desktop companion | 2.27.1 |
| Retail addon | 2.25.0 |
| Screen bridge | 2.25.0 |
| Infinite addon | 1.21.0 |

The internal package remains `@proj-airi/stage-tamagotchi`, with upstream package version `0.12.0-beta.5`.

## Desktop pet renderer

The desktop uses dsh-pet transparent WebM animations for its character, workspace, and settings preview.
The bundled blue-haired maid has 114 clips. The source MIT license accompanies the media.
Right-click the pet for sleep, wake, turn, random action, chat, and settings.

Open **Settings → Desktop pet appearance** to select or import a pack and set its scale from 50% to 200%.
A pack contains `pack.json` and its listed WebM files. Imports copy only validated media into `userData/dsh-pet-packs`.
Limits are 256 files, 32 MiB per clip, and 512 MiB per pack.

The main window owns speech playback and subtitles. Previews render animations without creating another speech host.
Model runtime capability is disabled in desktop renderers. Existing character and provider records remain available to their owning stores.
Shared model renderers continue to serve other applications in this workspace.

## Installation and usage statistics

Open **Settings → Installation and usage statistics** to configure the server or disable reporting.
The first-run disclosure has reporting selected by default. Collection starts only after the user selects Continue.
An empty endpoint sends nothing. Production endpoints require HTTPS. Loopback HTTP supports local development.

The main process persists a random installation identity and cumulative counters in `wow-installation-statistics-v1.json` under the personal data directory.
Registration sends the identity, its random upload secret, the companion release version, and the platform.
Every 300 seconds, a cumulative checkpoint reports provider-returned token fields and coverage counts.
Retries retain cumulative values. Sequence validation prevents duplicate server deltas.
Disabling reporting stops collection and cancels pending uploads. Ordinary backups exclude the installation identity.

The server does not receive chat, character facts, screenshots, audio, API keys, provider names, or model names.
Installation counts are not people counts. SDK generation records are not HTTP requests.
Missing usage stays unknown. Tool rounds can have partial coverage. TTS and ASR token usage is not included.
These metrics are not a complete bill.

The publisher endpoint comes from `resources/wow-statistics.json`. Leave the administrator key on the server.
The independent Docker service and deployment guide are in `../../../WOWAddons/WoWCompanionDataHub`.

## Development

From the repository root, run `pnpm install`.
Then run `pnpm dev:tamagotchi`.
Run `pnpm -F @proj-airi/stage-tamagotchi build` to build the app.
Development bridge use requires Windows and Python 3.10 or newer on PATH.
Windows companion releases include Python and do not require a separate installation.

## Game connection and companion behavior

Open **Settings → World of Warcraft Retail** or **Settings → World of Warcraft: Forever** for the matching connection.
Each page shows the connection, current character, and companion preferences first.
Archives, diagnostics, and activity controls start collapsed. Their detail components load only after you open them.

The addon owns equipment decisions. Comparison body v2 supplies its `assessment` and observed attribute `deltas`.
The bridge validates the contract. The desktop checks identity, correlation, and freshness, then presents the supplied result.
Confirm equipment changes inside the game. Desktop notices have no Yes/No buttons.
Historical v1 comparisons remain readable as manual-review archives and cannot trigger a live upgrade notice.
See [equipment authority](../../docs/ai/adr/wow-equipment-authority.md).

The addon also supplies quest candidates through the optional `qlog.advice` v1 capability.
The desktop schedules matching notices without recalculating quest eligibility.
See [quest reminder authority](../../docs/ai/adr/wow-game-reminder-authority.md).

Fixed level, death, revival, calendar, group-buff, and demonstration notices use translated templates without a chat-model request.
Configured speech uses the existing voice host and playback captions.
Without TTS, or after TTS failure, a current notice appears as text for eight seconds.
Mute and zero output volume suppress proactive notices.
Memories, natural conversation, location stories, and screenshot dialogue retain their existing model paths and persona settings.
See [companion responsibilities](../../docs/ai/adr/wow-companion-responsibilities.md) for ownership and delivery rules.

## Optional Warcraft tools

Open **Settings → WoW tools** for these nine tools and the first-use guide.
The hub retains `/settings/wow-guide`. Existing tool routes remain directly accessible.
The hub lists links without starting each tool's store.

| Tool | Route |
| --- | --- |
| WoW addon center | `/settings/wow-addons` |
| Game launch settings | `/settings/wow-launcher` |
| Backup and restore | `/settings/wow-backup` |
| Install and update | `/settings/wow-delivery` |
| Professions and materials | `/settings/wow-professions` |
| Retail local database | `/settings/wow-retail-database` |
| Data and cache | `/settings/wow-data` |
| Quests and leveling | `/settings/wow-quests` |
| Talents and equipment | `/settings/wow-builds` |

## Item archives and profile storage

The desktop stores bag and readable bank observations in `wow-companion-items.sqlite` under the active user-data directory.
Open the matching game's archive section to inspect equipment, profession materials, recipes, tools, and possible profession products.
Product candidates retain `craftingOrigin: "unknown"`. Their categories do not prove that the player crafted them.

Open each relevant bank in the game.
Keep the data grid visible until transfer finishes.
Closed banks retain dated observations. Unscanned banks remain unknown, and incomplete captures retain uncertainty.
See [item storage](../../docs/ai/adr/wow-item-storage.md) for categories, capture limits, and backup behavior.

The Windows launcher defaults to `%USERPROFILE%\.airi-wow-companion`.
Use `-UserDataPath` or `APP_USER_DATA_PATH` to select another profile.
The profile retains companion settings, histories, memories, and local databases across releases.
See [the stable profile design](../../docs/ai/adr/wow-companion-stable-profile.md).

## Profession materials

Open **Settings → WoW tools → Professions and materials** to plan Infinite recipe batches or a profession skill interval.
Recipe reference cards also link to this page. Remote queries require a configured wuxianwow MCP connection.
The planner combines current bag counts with explicitly entered extra stock.
Its bank stock remains unknown. Saved bank observations in SQLite do not automatically reduce the material requirements.
Optional auction estimates retain their collection time and market scope.
Deploy the updated game addon.
Restart the updated bridge to receive bag snapshots.
See [the planner design](../../docs/ai/adr/wow-profession-materials.md) for arithmetic and evidence limits.

## Retail database

Open **Settings → WoW tools → Retail local database**.
Select an exported SQLite snapshot.
Search items, maps, world maps, areas, spells, and dungeon encounters without a running game.
The chat tool uses the same read-only owner and identifies the local build and source tables.
Selection stores only the database path in `wow-retail-database-v1.json` under application user data.
Search starts a separate query-only Python helper. Clearing the selection closes that helper without deleting the source file.
See [the local query design](../../docs/ai/adr/wow-retail-database.md) for source limits and lifecycle rules.

## Data updates and cache

Open **Settings → WoW tools → Data and cache** to inspect or clear the shared 256 MiB query cache.
Static results expire after 24 hours. Price-bearing results expire after 15 minutes and retain their original collection time.
Clearing the cache keeps source databases and chat history.

Select a Retail installation and prepared offline CASCExplorer tools to detect local build changes.
The native update service starts its owner and monitoring on the first tool IPC request.
Companion startup only registers handlers. After first use, monitoring continues until application shutdown.
Start exports manually.
Inspect verified candidates before you activate one explicitly.
The active managed snapshot has retention priority.
The updater keeps two managed snapshots. External databases remain outside cleanup.
Pause client updates during export. Missing tools require local preparation without automatic downloads.
See [the update and cache design](../../docs/ai/adr/wow-data-updates-and-cache.md) for ownership and validation limits.

## Quest and leveling assistant

Open **Settings → WoW tools → Quests and leveling** to inspect observed objectives and search reference tasks.
Infinite queries wuxianwow. Retail searches the current character's quest log, with explicit limits on missing offline quest data.
Task readiness, client completion flags, and actual session turn-ins have separate labels.
Enable automatic reminders explicitly. They share a three-minute cooldown, quiet hours, and the existing model budget.
Only matching addon advice can trigger proactive quest reminders. Quest wording retains its natural-language model path.
Deploy the updated addon.
Restart the game and bridge to receive quest snapshots.
See [the quest design](../../docs/ai/adr/wow-quest-and-leveling-assistant.md).

## Talent and equipment explanations

Open **Settings → WoW tools → Talents and equipment** to inspect committed talents and the latest equipped-item capture.
Query node prerequisites and related abilities, or compare a pasted plan with observed invested ranks.
Supported plans use verified website talent formats or explicit node-ID/rank lists. Retail game import codes remain unsupported.
Choose one equipment slot and a candidate item ID to inspect known attribute differences and effect descriptions.
Base references do not establish instance bonuses, performance gains, or character usability.
Infinite uses wuxianwow. Retail uses actual observations and the existing local DB2 service.
Deploy the updated addon.
Restart the game and bridge to receive trait snapshots.
See [the explanation design](../../docs/ai/adr/wow-talents-and-equipment-explanations.md).

## Companion backups

Open **Settings → WoW tools → Backup and restore** to export saved personas, companion settings, and game histories.
The history scope includes a validated logical snapshot of the item archive.
Chats and attachments are optional. Credentials, login state, models, and send queues are excluded.
After the backup preview, select its scopes.
Confirm restoration on the next restart.
Recovery copies and the transaction journal live in `companion-backups` under the app user data directory.
See [the backup design](../../docs/ai/adr/wow-companion-backup.md) for startup ordering and recovery rules.

## Windows companion release

Run `node_modules/.bin/tsx.cmd apps/stage-tamagotchi/scripts/companion-release.ts --manifest-only` from the repository root.
Build the desktop app.
Then run that command without `--manifest-only` to produce the installer and portable ZIP.
The release bundles both companion addons, the bridge, and an isolated Python runtime.
The Windows installer and portable ZIP need no separate Python installation.
**Settings → WoW tools → Install and update** checks dependencies, resource integrity, and component versions.
To update with recovery, extract a newer portable ZIP into a separate directory.
Select that directory in settings.
The app saves a recovery point before starting the new executable. Keep the previous directory for rollback.
See [the delivery design](../../docs/ai/adr/wow-companion-delivery.md) for recovery limits.
See [embedded Python](../../docs/ai/adr/wow-companion-embedded-python.md) for the current runtime policy.

## Local model files

Sherpaw downloads remote model files into the app user data directory. The main
process serves installed files to the renderer through `airi-model`. The desktop
release bundles X-ASR through `airi-sherpaw`. Sherpaw settings control
remote downloads. The Resource Status Island shows transfer progress and errors.

## Computer use

The desktop chat composer starts with **Use computer** on. Turn it off to send a request without desktop access.
The selection is local to the composer. A new composer starts with it on. While a request runs, its selection is locked.
Turn it off before sending messages that must not receive computer-use tools.

Only the current selection grants access, including retries and tool reruns. Historical messages do not grant access.
The selected request receives `computer_use` and `computer_use_read_image`.
The first tool accepts AUV arguments, such as `["invoke", "window.list"]`.
Use `["invoke", "--help"]` and command-specific help to discover supported operations.
The image tool returns a screenshot as model image content. It accepts only PNG and JPEG artifacts inside the app's computer-use store.
Use a model and provider that support tool calls for visual tasks.
With **Use the vision model for tool images** on, the vision model reads the screenshot first for a chat model whose provider does not report image input.
The chat model then gets a text description. It has the visible text and layout, but no pixel positions.
Use AUV commands such as `screen.findText` to get coordinates.

Electron starts the matching AUV SDK and CLI 0.0.16 on demand, over a private Unix socket or Windows named pipe.
It serializes commands across windows, stores artifacts under the app's user-data directory, and stops the daemon during app shutdown.
The CLI runs without a shell. Model arguments cannot change the device, endpoint, run, or storage root.
Nonzero exits retain AUV output and failure details as tool errors. A zero exit code does not prove that the intended UI change occurred.

On macOS, grant Accessibility and Screen Recording permissions to the launching app when the OS requests them.
Some application actions also need Automation permission. If `app.probePermissions` reports missing screen-recording permission, a capture can contain only the desktop background despite exit code zero. Available commands depend on the OS and AUV backend.
Use this feature for local native applications. It does not expose a remote-device gateway or replace the separate `services/computer-use-mcp` service.

The desktop package includes the platform CLI as an optional dependency and unpacks its executable from ASAR.
Do not omit optional dependencies when building an installer. Windows ARM64 and Linux musl do not have a matching CLI in this version.

## Fullscreen workspace

The fullscreen workspace is an experiment, and it is off by default. It shows settings and the chat beside the character, in a workspace that covers the work area.
Turn on **Fullscreen workspace** in the experimental features of the system settings. Then choose a window mode:

- **Single window**: the main window grows over the work area and becomes the workspace.
- **Separate window**: a window of its own shows the workspace with its own view of the character. The main window stays on the desktop, above that window.

The two modes differ only in the window that hosts the workspace. Both use the same parts in `src/renderer`:

- `components/fullscreen/surfaces.ts` is the registry of the surfaces, such as settings and the chat.
- `stores/fullscreen.ts` holds the phase of the mode, the surface that shows, and the surfaces that stay mounted.
- `composables/use-fullscreen-layout.ts` holds the surface width, its drag, and the place of the character.
- `components/fullscreen/fullscreen-overlay.vue` shows the island and the surface. `fullscreen-backdrop.vue` shows the backdrop.

Each host adds only what its window needs:

- `pages/index.vue` is the page of the main window. It runs the open and close transitions, because the main window moves and grows.
- `pages/workspace.vue` is the page of the separate window. The window covers the work area from the start.
- In `src/main`, `windows/main` and `windows/workspace` answer the same fullscreen events for their windows.
- `src/main/index.ts` opens settings and the fullscreen chat where the mode says.

To add a surface, add an entry to `fullscreenSurfaces`, and add its id to `FullscreenSurfaceId` in `src/shared/eventa`.
The island then shows its button, and its panel stays mounted until the mode closes. The routes under its `prefixes` sit under the page of each host.

When the user changes the window mode, `moveFullscreen` in `src/main/windows/shared/fullscreen.ts` moves the workspace.
It packs the surfaces of the old window, closes that window through its pages, and opens the pack in the new window.
A page with unsaved changes can stop the move. A panel that holds state calls `useFullscreenCarry(surface, { collect, restore })`.
The chat carries its unsent draft this way, and settings carry the page that shows.

The view of the character in the separate window is a second render. It only renders the model, so the main window stays the one host of voice.
It does not follow speech or expressions.

## Verification

Run the focused runtime tests:

```sh
pnpm -F @proj-airi/stage-tamagotchi exec vitest run src/main/services/airi/computer-use/runtime.test.ts
```

Run the tests of the fullscreen workspace:

```sh
pnpm -F @proj-airi/stage-tamagotchi exec vitest run src/renderer/stores/fullscreen.test.ts src/renderer/window-context.test.ts src/main/windows/chat/mode-switch.test.ts src/main/windows/shared/fullscreen.test.ts
```

Set `AIRI_COMPUTER_USE_LIVE=1` to include the bundled CLI/private-daemon test.
It invokes help and an invalid argument, without injecting desktop input.
For renderer verification, launch with `APP_REMOTE_DEBUG=true` and an unused `APP_REMOTE_DEBUG_PORT`, then attach `agent-browser` to the chat CDP target.
