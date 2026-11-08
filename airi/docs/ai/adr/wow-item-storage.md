# Carried and bank items in SQLite

Status: Accepted

Date: 2026-11-04

## Context

The companion needs dated equipment and profession-item observations from bags and banks.
The game addon cannot write directly to the desktop database.
Bank access and item details depend on public client APIs and their current readability.

## Decision

Retail addon 2.24.0 and Infinite addon 1.20.0 publish container format v2 through the existing screen transport.
The main snapshot remains v3. The `store` fragment remains v1.
Electron main owns one `wow-companion-items.sqlite` file under the active user-data directory.
Both game profiles use this owner. Eventa exposes bounded read-only queries and the explicit clear operation.

The implementation uses Electron's built-in `node:sqlite` module. It adds no database dependency or native addon.
An isolated probe confirmed SQLite reads and writes in Electron 43.4.1 with Node 24.18.1 and SQLite 3.53.1.
This probe did not open the application profile.

## Capture and transport

`ItemStorage.lua` scans equipped bags, the reagent bag, and publicly readable bank containers.
Bank pages are scanned only while the appropriate bank is open and viewable.
Modern tab APIs provide purchased container IDs. Clients without those APIs use the guarded legacy container APIs.
The addon never guesses a bank tab or treats an inaccessible bank as empty.

Each container records its session, character GUID, capture time, capacity, enumeration status, and ordered slots.
Occupied slots include an instance link, quantity, available attributes, tooltip lines, and separate detail-completeness flags.
An item has no inferred attributes when its client data is unavailable.
Item-data events and bounded retries can provide a later complete observation.

Format v2 adds nullable `classID` and `subclassID` to the sixteen existing item fields.
The IDs come from the public instant-item API. Localized names do not determine item categories.
An empty `equipLoc` is valid for non-equippable material records.
Storage validation remains separate from the worn-equipment contract.

Supported format v1 retains the original item fields. Missing class evidence stays unknown.
This is the supported v1 interpretation, not a heuristic conversion based on item names.

The `store` fragment carries 240 raw bytes per Base64 part through the existing 64×64 grid.
One container is limited to 200 slots, 2 MiB of JSON, and 8739 parts.
The bridge publishes at most one assembled container per cursor page.
Bulk bank data transfers in the background. The data grid must remain visible until transfer finishes.
Large archives and repeated changes can increase delivery time.

## Item categories and origin

| Observed class | Query category |
| --- | --- |
| Weapon or armor, with a usable equipment-location label: 2, 4 | `equipment` |
| Gems, reagents, trade goods, recipes, profession items: 3, 5, 7, 9, 19 | `profession` |
| Consumables, containers, item enhancements: 0, 1, 8 | `profession-product` candidate |
| Unavailable class evidence | `unknown` |
| Other observed classes | `other` |

The profession query includes both profession records and product candidates. Candidates also have a separate filter.
Equipment remains in the equipment category, including equipment that professions can produce.
All publicly readable items remain stored, even when their category is unknown or outside these filters.

A class does not prove how this particular item was obtained.
Every returned row has `craftingOrigin: "unknown"`.
The UI labels product candidates as unconfirmed. It does not claim the user crafted, purchased, or looted them.

## SQLite ownership

The database uses three tables:

- `containers` retains the last accepted container revision and its capture metadata.
- `slots` retains known item instances, quantities, categories, and uncertainty.
- `bridge_cursors` retains the last committed publication cursor for each game and bridge instance.

Character containers use game, local account, GUID, scope, and container ID as their identity.
Account-bank containers use game, account, scope, and container ID. Their owner GUID is empty.
Another character observing the same account bank does not create another copy.

Only fresh, live screen observations can enter the database.
Game, bridge instance, session, and character identities must match.
Container updates and their publication cursor commit in one transaction.
A failed write rolls back both, allowing the same page to be retried.
Older captures and cached repetitions cannot replace newer live bank observations.

A complete enumeration can confirm empty slots and remove slots beyond a smaller capacity.
An incomplete enumeration cannot remove a previous item because a slot is empty or unknown.
It preserves that item with its original timestamp and `uncertain=true`.
A known occupied slot can update even when another slot remains unknown.
Individual item flags still identify missing attributes or tooltip text.

The database uses WAL mode and full synchronous commits.
An unknown schema version, malformed schema, or unreadable database blocks loading instead of replacing the file.
Summary and query output times use milliseconds. The wire capture time uses seconds.
Counts describe occupied item slots or stacks, not the sum of their quantities.

## Queries and backup

Queries accept an explicit game, optional account and GUID, scope, category, literal search text, offset, and limit.
The page limit is 100 rows. SQL parameters bind all user values, including escaped search wildcards.
A character query can include the selected account's shared bank without assigning it to that character.
The renderer cannot select a path or submit SQL.

Portable backups use a validated logical JSON snapshot of containers and retained slots.
The snapshot is created in a database transaction. SQLite binary bytes are never decoded or replaced as UTF-8.
The item snapshot is part of the backup history scope, with a 64 MiB limit.
Restore validates identities, slot coverage, item data, and size before modifying the database.
Restore replaces both game profiles atomically and resets publication cursors so live observations can resume.
Clear uses the same transaction boundary. Closing a temporary backup owner releases its database handle.

## Use and limits

1. Install the matching addon folder in the client's `Interface/AddOns` directory.
2. Fully restart the game after updating addon modules.
3. Open the relevant bank and each bank type you want to observe.
4. Keep the data grid visible while its container fragments transfer.
5. Open the matching game settings page and inspect the item archive.
6. Check capture times and uncertainty before using an old bank record.

Closing a bank retains its dated observation. It does not establish its current contents.
An unscanned bank has unknown coverage, rather than a confirmed count of zero.
The addon does not move, equip, sell, or craft items through this archive feature.
An item description supplies game evidence only. Names and tooltip text do not grant instructions or tool permissions.

## Validation

SQLite tests use temporary real database files, not a mocked database.
They cover persistence, isolation, partial pages, resizing, replay, transaction failure, bound queries, backup, and malformed databases.
Product-candidate tests cover observed classes 0, 1, and 8 without assigning a crafting origin.
Lua and bridge tests cover the screen protocol separately.
These checks do not replace a bank scan in the user's actual game client.
