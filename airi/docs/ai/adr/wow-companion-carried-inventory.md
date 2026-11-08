# Read-only carried inventory

Status: Accepted

Date: 2026-11-01

## Scope

Profession planning needs observed carried-material counts. Equipment acquisition history cannot supply these counts.
The user selected automatic bag collection and manual stock supplements. Bank contents remain unknown.
This change collects item identifiers and quantities. It does not learn professions, enumerate recipes, or execute game actions.

## Capture and transport

Both game addons own an `Inventory.lua` collector. It reads only equipped bags through public `C_Container` APIs.
Container failures, secret fields, inaccessible tables, invalid quantities, and entry clipping produce `complete=false`.
A missing item means zero only in a complete capture. Known counts from a partial capture remain lower bounds.
The bank marker is always `unknown`. No bank API is called.

Bag events coalesce for 400 milliseconds. Quiet bags refresh after 30 seconds, after the previous first transmission finishes.
Leaving the world cancels pending capture and clears inventory replays.
Identity must match before and after collection. A source capture includes its session, character GUID, revision, and server timestamp.

Independent `inv` frames carry 240-byte chunks through the existing CRC-protected grid.
The 504-byte character heartbeat remains unchanged. Fresh equipment acquisitions and comparisons retain priority.
The first inventory pass precedes background gear. Later replays share spare data slots.

## Receiver

The Python bridge validates each fragment and publishes a complete revision atomically.
Transfer completeness and capture completeness remain separate facts.
Two in-flight revisions consume bounded memory. Conflicts reject that revision. Pending transfers expire after 20 minutes.
A snapshot permits 1,000 sorted unique items, 65,536 bytes, and 274 fragments.

Session and GUID bind each revision to the current live character. Old revisions cannot replace newer captures.
Duplicate replay does not renew receipt time. Newer pending revisions hide older counts until completion.
Demo, stale, paused, offline, error, and foreign observations cannot supply automatic inventory.
Source timestamps outside the previous 20 minutes or more than 120 seconds ahead are rejected.
Planning consumers apply their own shorter freshness window before deducting stock.

`GET /api/status` adds required nullable fields: `inventory`, `inventoryReceivedAt`, and `inventoryError`.
The shared `inventorySnapshotSchema` matches the validated source shape. Inventory is not persisted as character history.
The desktop requires bridge 2.16.0. Addon source versions become Retail 2.16.0 and Forever 1.14.0.
The generated resource manifest includes the new Lua module and current file hashes.

## Validation boundary

Tests execute the actual Lua collector and encoder. Python and TypeScript validate the resulting fixtures.
Coverage includes aggregation, partial captures, secret data, banking exclusion, expiry, replay, identity, and clock failures.
Existing equipment, confirmation, loadout, geometry, and HTTP contract tests remain in scope.
Validation does not start a game, deploy an addon, stop an existing bridge, or call a personal model.
Source updates and resource manifests do not update previously generated Windows installers.
