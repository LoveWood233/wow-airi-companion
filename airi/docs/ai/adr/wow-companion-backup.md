# Companion backup and cold restore

Status: Accepted

Date: 2026-11-01

## Scope

The user approved local backups, a restore preview, automatic recovery copies, and rollback after failure.
Chat history is optional. Service credentials, login state, model files, and send queues stay outside portable backups.
No dependency was added. The archive is one JSON file with format version 1 and SHA-256 integrity checks.
Checksums detect damage. They do not authenticate an archive or encrypt its contents.

## Saved data

The settings page exports saved personas and whitelisted preferences from localStorage.
Structured credential fields are removed from portable preferences. User-authored text remains intact.
Game settings come from their live owner after history writers finish their pending saves.
The main process reads only a fixed catalog of 17 settings and history files for both game profiles.
Capture settings, window calibration, and launcher paths belong to settings. Existing domain schemas validate each imported file.

Each manifest entry contains a scope, identifier, byte count, and content checksum.
The whole archive also has a checksum. The application checks format version, scope availability, and owning schemas before scheduling.
Archives cannot select restore paths. The supported archive limit is 256 MiB. Each catalog file is limited to 64 MiB.

Portable chat exports include indexed sessions and inline image or audio attachments.
Missing attachments fail the export. Rollback snapshots retain all saved index and session keys, including orphan sessions.
The storage owner converts physical IndexedDB keys to canonical unstorage keys. The outbox namespace remains separate.

## Confirmation and startup

Selecting a file only creates a main-process plan. The renderer receives metadata and an opaque plan identifier.
Confirmation saves the archive and selected scopes to `userData/companion-backups/pending-restore.json`.
The user can cancel before restarting. Scheduling does not change live preferences, game records, or chat storage.

Startup runs maintenance before windows, stores, bridge connections, and cloud sync start.
The maintenance window uses the same `index.html`, preload, and session as the normal application.
The bootstrap selects the maintenance module through a query parameter. It does not import the normal application entry.
Using the same document also preserves storage identity in packaged file-based builds.
The maintenance RPC context accepts messages only from its own window.
Closing this temporary window cannot trigger the normal all-windows-closed quit path.

The transaction order is:

1. Read the selected current files and exact browser keys.
2. Save a portable `before-restore-<time>-<uuid>.wowbackup.json` recovery copy.
3. Write and sync the `applying` journal before changing saved data.
4. Apply the selected files and browser data.
5. Write and sync the `committed` journal.
6. Save the result and remove the pending request and journal.

A failed apply restores the exact previous file bytes and browser keys.
An interrupted `applying` journal triggers rollback on the next startup.
A `committed` journal only finishes cleanup. It never replays the import.
If preparation or rollback fails, normal startup stops and preserves the recovery files.
After resolving disk or permission errors, restart to retry.
Before a journal exists, removing `pending-restore.json` cancels an unapplied request.
Do not remove an `applying` journal. It holds the rollback state.

## Chat imports

Chats are added as new local copies under the original account and persona partitions.
Existing sessions remain available. Imported sessions lose cloud identifiers, task state, hidden status, and recipe bindings.
A local binding prevents automatic cloud synchronization. Existing outboxes and authentication remain untouched.
Imported inline attachments use the existing asset migration when the session is read.
Rollback changes no asset records, so references in the previous snapshot remain valid.

## Validation boundary

Node tests use temporary files and an external browser storage port.
Browser tests use real localStorage, IndexedDB, attachment blobs, Vue components, and translated controls.
Only Electron IPC is mocked in the settings tests.
The checks cover damaged archives, rollback failure, startup retry, committed cleanup, optional chats, credentials, and explicit confirmation.
No personal data was restored. No game client, model request, speech request, or real account synchronization was exercised.
