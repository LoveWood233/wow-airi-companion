# Local Retail database queries

Status: Accepted

Date: 2026-11-01

## Scope

The user approved local Retail queries after the profession planner.
Supported kinds are items, underlying maps, player world maps, areas, spells, and dungeon encounters.
The desktop page and native model tool share search, fetch, and snapshot statistics.
The source is the existing local CASC export. This task adds no dependency or Codex MCP configuration.

## Source ownership

The native file picker selects an exported SQLite database.
The main process validates the candidate through a read-only statistics request before activating it.
Only a validated selection reaches `wow-retail-database-v1.json` in the application user data directory.
A failed replacement keeps the previous selection. Removing a selection does not delete its database.
The selected path appears only in the local settings page. Model results omit filesystem paths and `gameRoot`.

The source label is `正式服本地 DB2` with game `retail` and product `wow`.
Results retain build, locale, export time, snapshot identity, dependent tables, and encrypted-section status.
Snapshot identity uses metadata and file identity evidence. It is not a claimed database content checksum.
Receipt time describes the returned query, separately from the export time.

Map, world-map, area, and encounter identifiers have distinct namespaces. Underlying map ID zero is valid.
SQL NULL fields are omitted with a missing-field notice. Empty strings remain empty strings.
Unknown column meanings and raw spell templates remain uninterpreted.
The client snapshot cannot prove live server hotfixes, auction prices, player progress, or complete quest instructions.

## Read-only process boundary

The existing Python bridge has a separate `query-only` mode on fixed loopback port 18767.
This mode does not import capture or window modules, start capture threads, or load capture configuration.
The main process starts its own hidden child lazily and supplies the selected path through process arguments.
An instance identity and per-process token distinguish this helper from other listeners.
Health and query requests require that token. No HTTP operation configures a filesystem path.
Closing the stdin lifetime lease stops the owned helper. Other bridge processes remain independent.

Python uses SQLite `mode=ro`, `query_only`, fixed table and column allowlists, parameterized queries, and a two-second progress budget.
Requests cannot provide SQL, table names, database attachments, or paths.
The query layer performs no schema changes, indexing, export, download, or hotfix merge.
HTTP and desktop schemas bound request sizes, pagination, field lengths, and response sizes.
Errors cross the boundary as codes rather than raw SQLite messages.

Selections carry a revision. Late queries cannot populate a newly selected snapshot.
The main process serializes selection commits and keeps disk and memory consistent.
The renderer also isolates pending requests and clears results when the selected snapshot changes.

## Model and UI

`builtIn_wowRetailQuery` accepts one strict parameter: a JSON-encoded request string.
The desktop validates that string before invoking Eventa. The main process validates the decoded query again.
The source schema binds result identity, table provenance, operation, and pagination to the requested record.
The chat card reads the actual recorded result. It does not request a generated card or an external webpage.
Desktop cards link to local entity details using validated typed identifiers.

The settings page initializes configuration only. Explicit search, statistics, selection, or entity links initiate reads.
Changing a draft does not query the database. Pagination preserves the previous query context.
Failed requests, empty results, absent IDs, source limits, and encrypted data have distinct presentation.
The native tool is registered through the existing leader-owned built-in tools action.
Query clients and transient page state remain outside synchronized Pinia state.

## Verification and delivery

Tests use temporary SQLite files and real Python for the Node-to-HTTP boundary.
Real Vue and Pinia tests mock external IPC only.
Read-only verification also compares the existing exported database before and after bounded queries.
No personal model, voice service, live game, or game capture is used for acceptance.
The resource catalog supplies packaging filters, integrity checks, and Python prerequisites from one list.
Previously generated Windows installers remain their prior snapshot.
