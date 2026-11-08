# Data updates and query cache

Status: Accepted

Date: 2026-11-01

## Approved policy

The user approved a 256 MiB query cache, 24-hour static TTL, and 15-minute auction-request TTL.
Game, build, data locale, source snapshot, connection identity, operation, and canonical parameters form the key.
The main process owns disk records for native Retail queries and the wuxianwow MCP connection.
The profession page and chat use that same MCP owner.

The user also approved background detection of installed Retail builds.
Detection prompts for action. It never starts an export, download, model request, or voice request.
An export requires a user action. A verified candidate requires a separate activation action.
The current managed snapshot has priority within the two-snapshot retention policy.
External databases and earlier CASC exports remain outside managed cleanup.

## Cache evidence

Original query receipt, database export, and auction collection times remain unchanged.
Cache evidence records storage, serving, and expiry separately.
The UI identifies a cache hit. A recent cache read cannot imply a recent auction collection.

Retail queries verify the selected source identity before cache lookup.
MCP caching requires a verified client build and snapshot timestamp from the advertised stats tool.
Successful metadata probes do not persist between explicit requests.
A cache miss verifies the source again after the record returns. A changed source cannot supply a cache entry.
Auction snapshots also retain their market and collection identity.
Unknown source identities, failures, writes, and creative tools bypass cache storage.

The MCP normalizer removes reserved metadata from remote results.
Only the desktop Eventa boundary trusts evidence stamped by the main process.
The restricted MCP acceptance flow bypasses caching and hidden metadata probes.
Cached responses cannot count as real-source acceptance receipts.

Clear, connection changes, and selection changes advance a generation.
Earlier requests cannot refill cleared storage or publish data under another source identity.
Expired entries are removed before capacity eviction. Remaining pressure evicts least-recently-used entries.
Limits use serialized file bytes. Individual records and key complexity are bounded.
Cache failures leave fresh source reads available.
Cleanup accepts only cache-owned names inside a validated physical directory.
The query cache excludes source databases, snapshots, credentials, and chat history.

## Offline Retail update

The user selects the game root and prepared CASCExplorer tools through native folder pickers.
The updater records these selections in `wow-data-updates/settings-v1.json` under application user data.
Startup and five-minute checks read build metadata only.
Known active-source builds take priority when deciding whether selected data is older than the installed client.

The runner uses a prepared local .NET exporter, then the existing Python SQLite builder and verifier.
It does not invoke the older PowerShell path that prepares dependencies online.
Offline preparation disables restore and workload advertising downloads and writes a source/binary fingerprint stamp.
Missing or modified preparation fails with a diagnostic. The application never downloads a replacement.
CascLib local-only guards also block missing-index CDN fallback.
The exporter selects one active Retail product. Ambiguous active rows fail validation.
The verifier uses streaming SHA-256 compatible with the existing Python prerequisite.

Each job owns a UUID staging directory and direct child-process handles.
Cancellation waits for children to exit before attempting cleanup under the selection lease.
An exit code alone cannot prove a valid export.
Validation checks raw hashes, database integrity, row counts, supported table signatures, game, locale, and build.
Tool and definition fingerprints must remain stable.
The source check compares build metadata, configuration, indexes, and archive file generations before and after export.
Large archives use size and timestamps. This is not a volume snapshot or a guarantee against arbitrary concurrent rewriting.
Pause client updates while exporting.

Only validated output receives a ready marker and becomes a candidate snapshot.
Activation verifies the candidate again through the native Retail selection owner.
Failed or cancelled jobs do not change the user's current database selection.
Managed cleanup checks physical roots, ownership markers, and tree links before any move or recursive removal.
A selection lease protects staging promotion, failed/cancelled cleanup, and retention cleanup during asynchronous validation.
If the user selects a staging database from another native picker, promotion returns busy and cleanup preserves its path and files.
Background checks and configuration commits are serialized to prevent an old game root from overwriting a new baseline.

## Delivery boundary

Tests cover real filesystem cache records, temporary SQLite sources, direct subprocess cancellation, and actual Python verification.
The CASC reading process uses small fixtures during job integration tests.
The updater and Retail service integration command runs serially: 11 updater tests plus 11 Retail service tests, 22 total.
This count excludes cache, UI, and other separately recorded checks.
No full live-client export, personal model request, voice request, or game deployment is part of this acceptance.
Previously generated Windows installers remain their prior snapshot.
