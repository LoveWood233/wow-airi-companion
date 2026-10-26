# Faster Warcraft equipment suggestions

Status: Accepted

Date: 2026-10-25

## Context

The user received equipment with higher item level and Strength, but lower Mastery. The previous rule classified every stat tradeoff for manual review.

The user wants an equipment suggestion for this tradeoff. The suggestion must state the gains and losses before the user decides.

Screen capture also failed for a one-pixel grid. Blended pixels prevented valid CRC decoding. A matching two-pixel grid restored live capture.

## Decision

The release uses desktop and bridge version 2.10.0, Retail addon version 2.9.0, and Forever addon version 1.6.0.

Ordinary complete equipment can produce a suggestion when its item level and current primary stat increase, and only recognized secondary ratings decrease.

This assessment uses `review` with reason `primary_upgrade_tradeoff`. Both the addon and desktop apply the same rule.

The item must remain usable, appropriate for the current specialization, and comparable with the equipped item.

Unknown attributes, complex effects, sets, sockets, and enchantments still require manual comparison. Losses in Stamina, Armor, or weapon damage do not qualify.

The localized suggestion states the measured gains and losses. It does not promise higher damage or claim that every attribute improved.

Without configured voice synthesis, the bubble shows text and choices directly. With voice synthesis, the choices appear after playback.

The desktop choice preserves the native confirmation flow. Choosing “好” directs the player to click “确认换装” inside Warcraft.

No equipment operation occurs from a desktop click. The addon checks the item and current game state again before the native operation.

## Transmission

The addon updates business snapshots every second. An independent ticker transmits a frame every 250 milliseconds.

The bridge supports capture intervals from 100 to 5000 milliseconds. Its default is 100 milliseconds.

The desktop main process and renderer poll every 250 milliseconds. Existing comparison fragments and character snapshot version 3 remain unchanged.

An ordinary eight-fragment comparison and offer take approximately seven seconds in the transmission schedule. Capture errors, item loading, and queues can increase this time.

The estimate is not a measured guarantee for live loot. Final runtime observations belong in the implementation report.

CRC checks and rejection of blurred pixels remain unchanged. Capture settings must match the visible grid size and position.

## Manual review

Retail provides `/wowc equip check [itemID]`. Forever provides `/wowf equip check [itemID]`.

Without an item ID, the command reviews current bag equipment. With an item ID, it reviews matching items.

The command sends eligible comparisons and offers. It does not fabricate acquisition events, alter the acquisition baseline, or append equipment acquisition history.

Items without loaded data request their public item data first. Missing evidence does not produce an item-level-only suggestion.

## Validation

Related tests cover both Lua producers and the desktop assessment. They include eligible primary-stat tradeoffs and excluded losses or complex equipment.

Browser tests exercise localized bubbles, measured gains and losses, the current player name, missing voice, and native confirmation instructions.

Live bag review can exercise the prompt without a new acquisition or an equipment operation. Genuine new-loot timing still requires an observed acquisition.
