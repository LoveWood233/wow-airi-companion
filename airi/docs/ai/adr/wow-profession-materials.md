# Profession material planning

Status: Accepted

Date: 2026-11-01

## Scope

The user approved a profession planner with automatic bag counts and manual extra stock.
Chinese WoW Forever is the first supported database. Retail lookup follows as a separate task.
Classic is outside this task.

The desktop settings page supports recipe batches and profession skill intervals.
Desktop recipe cards link to this page with a typed recipe identifier.
Opening the settings page reads local bridge state. Remote database requests require a user action or an explicit recipe link.
This feature does not request a model or voice service.

## Data and arithmetic

The existing wuxianwow MCP connection supplies real recipe records and leveling routes.
The parser keeps recipe IDs, spell IDs, and item IDs separate.
Only fixed, identified item quantities support exact arithmetic.
An item-count target rounds up by the proven output per craft.
Multiple recipes share one inventory balance. Their selected order defines intermediate reuse.

Skill routes are clipped to the requested interval.
The planner fetches the selected steps and preparation recipes before calculating their products.
Source material summaries include intermediate products. They cannot be used directly as shopping lists.
The calculation reuses intermediate output and reduces preparation when known stock already supplies that output.
Preparation reductions never remove the main crafts needed for skill gains.
Missing recipe evidence suppresses procurement quantities instead of inventing yields.
Source methods, training requirements, assumed levels, and uncertain skill gains remain visible.

`stage-shared/wow-knowledge` owns the schemas, pure calculation, and bounded MCP readers.
The desktop source adapter owns advertised-tool discovery and explicit read-only calls.
The Pinia store owns the current plan, inventory selection, and extra stock.
The shared reference widget supplies only a navigation link. It does not calculate or query.

## Inventory evidence

Both game plugins scan carried bags and aggregate item counts by item ID.
Inventory uses separate `inv` transfer fragments. It does not enlarge the character heartbeat.
The bridge validates identity, revision, fragment consistency, size, and capture time before exposing a snapshot.
The desktop requires a live screen observation with the same character and session.
Demo, stale, mismatched, or missing data cannot establish current stock.

A complete bag snapshot establishes zero for an absent item ID.
A partial snapshot supplies known lower bounds. Missing quantities remain upper bounds.
Bank contents remain unknown. Manual quantities represent additional stock outside observed bags.
The page warns against entering the same bag materials twice.
Character or session changes clear manual quantities and price evidence.
Inventory is not written into character history.

## Price evidence

Optional estimates query collected auction quotes for missing item IDs.
The adapter combines quotes only when their realm, faction, and collection time agree.
Unknown variants do not supply generic material prices.
The result keeps the original collection label and source notices.
Missing quotes produce a partial subtotal. Old snapshots remain visibly stale.
The listed market does not establish applicability to the current character.
No action buys, sells, crafts, or controls the game.

## Delivery and verification

Tests cover structured source data, batch arithmetic, partial inventory, preparation reuse, price scope, and real browser interaction.
Plugin and bridge tests cover inventory transfer alongside existing equipment messages.
The Lua collectors need real-client acceptance after deployment.
The updated Python bridge needs a restart. Deploy the full updated addon, then restart the client to load its new TOC module.
Previously generated Windows installers do not include this source change.
This task does not publish a release or change Codex MCP configuration.
