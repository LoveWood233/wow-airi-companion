# Group buff voice reminders

## Behavior

Entering a grouped dungeon, raid, scenario, or battleground starts a buff check. Arena and outdoor groups do not start checks.
The addon waits five seconds for loading. Two observations, at least two seconds apart, must identify the same missing members.
The desktop speaks once per character session, instance entry, and supported buff. Reloading the addon creates a new session.
Combat, death, mute, missing speech configuration, and busy voice turns defer the reminder.
Fresh observations continue to invalidate queued speech when members receive the buff or the player leaves.

The supported buffs are Battle Shout, Arcane Intellect, Power Word: Fortitude, Mark of the Wild, Skyfury, and Blessing of the Bronze.
The spell must be known by the active character. Passive effects, personal weapon buffs, and combat cooldowns are excluded.
Bronze uses recipient-specific aura IDs. Its localized aura name also identifies coverage.

## Observation boundary

`GroupBuffs.lua` reads the group roster and complete helpful aura lists through public game APIs.
Disconnected, dead, invisible, or out-of-range members are unknown. Secret values, inaccessible tables, errors, and incomplete enumerations also remain unknown.
One confirmed missing member is enough. The reminder does not claim that every member was checked.
The modern aura and spellbook APIs are required. Clients without these APIs stay silent, including unsupported custom server builds.
No addon or desktop code casts a spell or sends game input.

## Transport and lifetime

A single `kind=buff` frame carries session, GUID, entry counter, publication sequence, spell, counts, and instance identity.
Buffs and calendar alternate within the calendar's existing data slots. Equipment and heartbeat bandwidth stay unchanged.
Buff frames arrive every four seconds. Calendar entries also arrive every four seconds instead of two.
The bridge validates the frame and requires a live snapshot with matching session and GUID.
It exposes observations for six seconds only. Replayed publication sequences cannot renew this lifetime, including after a stale capture.
Combat, death, offline status, and instance changes hide observations immediately on the next snapshot.

The renderer also checks class, current character, session, GUID, and instance identity.
The owner stores at most 256 dispatch receipts in local storage. The receipt precedes speech, so failed attempts do not loop.
Speech uses the current character's configured voice through the existing voice host. It needs no chat or vision model.
A game-state change cancels pending synthesis or playback. Each utterance has a twenty-second lifetime.

## Evidence

- [Blizzard aura API definitions](https://raw.githubusercontent.com/Gethe/wow-ui-source/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/UnitAuraDocumentation.lua)
- [Blizzard spellbook API definitions](https://raw.githubusercontent.com/Gethe/wow-ui-source/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/SpellBookDocumentation.lua)
- [Blizzard secret-value predicates](https://raw.githubusercontent.com/Gethe/wow-ui-source/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/SecretPredicatesDocumentation.lua)
- [WeakAuras spell templates](https://raw.githubusercontent.com/WeakAuras/WeakAuras2/main/WeakAurasTemplates/TriggerTemplatesData.lua)

Real Lua tests exercise both addon copies, secret values, group coverage, entry changes, and encoded transport frames.
Bridge tests cover validation, stale replay rejection, character isolation, combat, and instance changes.
Renderer tests cover receipts and state eligibility. Browser tests exercise the real voice store with a mock speech provider.
These tests do not establish live game API behavior or audible playback on the user's device.
