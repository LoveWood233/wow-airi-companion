# Warcraft companion responsibilities

Status: Accepted

Date: 2026-11-04

## Problem

The addon and desktop both evaluate equipment upgrades. Desktop quest reminders also derive eligibility from repeated snapshots.
Detailed archives and tools occupy the normal connection settings page. Fixed game notices request a chat model for predictable text.

## Ownership

| Owner | Responsibility |
| --- | --- |
| Game addon | Public game observations, equipment decisions, quest candidates, game confirmation and execution |
| Screen bridge | Frame integrity, bounded reassembly, schema validation and session isolation |
| Desktop companion | Related memories, natural conversation, voice, captions, vision, event delivery and local archives |
| Optional desktop tools | Addon installation, launcher, knowledge queries, delivery checks, backups and data updates |

The desktop validates identity and freshness. It does not recreate the addon's equipment or quest eligibility rules.
The game repeats equipment checks when the player clicks its confirmation button. A desktop notice cannot equip an item.

## Game conclusions

Comparison bodies use v2. The addon supplies `assessment` and observed `deltas` with the comparison facts.
The desktop checks the envelope and corresponding item evidence, then reads the supplied conclusion.
The full TypeScript upgrade evaluator is removed. Historical v1 comparisons remain readable as manual-review archives.
They cannot create a new live suggestion. The supported archive policy is specified in `wow-equipment-authority.md`.

Quest logs retain their existing version and add an explicit `advice` capability.
The addon produces ready, observed turn-in, level-risk and post-level-up candidates.
The desktop checks correlation, delivery receipts and age. Missing advice grants no reminder eligibility.

The existing addon money counters remain the source of inflows and outflows.
The desktop keeps cross-account summaries and archives. It does not infer transaction purposes from balance changes.
The existing real-time level history remains separate from the addon's online-duration history.
These duration definitions are not interchangeable. This refactor does not discard either archive.

## Delivery

Fixed level, death, revival, demonstration, group-buff and calendar notices use translated templates.
They use one pending slot and one active audio owner across both game profiles.
The pending slot keeps the highest-priority recent notice. Invalid or expired observations are discarded.
Equipment notices and user conversation take precedence. Character, session and language changes invalidate old notices.

Fixed notices do not request a chat model or consume the background chat-model budget.
Configured speech uses the existing voice host and its playback captions.
Without speech, or after speech failure, a current notice appears as text for eight seconds.
Ordinary conversation, memory-based chatter, location stories and screenshot dialogue keep their existing model paths and persona settings.
Quest reminder wording also keeps its existing natural-language path. Its eligibility now belongs to the addon.

Equipment bubbles no longer ask for a second desktop confirmation.
They explain the recommendation and direct the player to the game button.
After speech finishes, the equipment notice remains visible for three seconds.

## Interface and optional tools

Connection settings show current character information and companion preferences first.
Archives, diagnostics and activity controls start collapsed. Detail components load when opened.
The existing guide route becomes the Warcraft tools hub. All existing tool routes remain directly accessible.
The hub does not initialize a tool store merely to list its link.

The local database-update service starts its owner and monitoring on the first explicit tool request.
Companion startup registers its handlers without starting monitoring.
After first use, monitoring remains active until normal application shutdown.
Shutdown invalidates late folder-picker results and disposes the optional service only when it was created.

## Data and release

No profile path, provider credential, archive file, SQLite table or relationship rule changes.
Backups retain existing game history. Old live equipment comparisons need matching updated components.
The role snapshot remains v3 and the screen frame remains 64 by 64 pixels.
Release versions are desktop, retail addon and bridge 2.25.0, and Infinite addon 1.21.0.

## Validation

Focused tests cover producer conclusions, old archives, cross-language frames, quest advice, captions, optional tools and retained data.
Desktop builds do not call the user's models or operate the game.
Live equipment and bank behavior still require validation in the actual client.
