# Quest and leveling assistant

Status: Accepted

Date: 2026-11-01

## Approved behavior

The user approved actual quest-log capture, objective progress, evidenced completion records, and explicit quest reference queries.
Forever uses wuxianwow. Retail uses the current character's observed quest log and existing local map references.
The six-kind Retail DB2 service does not provide a complete quest catalog.
Classic is outside the live-capture scope.

The settings page shows actual progress and searches by level, faction, region, and text where source data supports those filters.
Task chains, start and end actors, temporary coordinates, and risk explanations retain their evidence limits.
Missing prerequisites cannot imply that a task is available.
Missing coordinates cannot establish a travel route.

The model and page use separate query clients with the same bounded contracts.
Registration and page initialization do not query remote references.
Only explicit requests access the public database through the existing main-process cache.
Character or revision changes discard in-flight progress associations.
Remote references never supply player progress.

## Quest evidence

Both addons send independent bounded quest fragments without enlarging the character heartbeat.
Session, character GUID, revision, observation time, coverage, and truncation accompany the data.
The bridge validates the complete transfer before publishing a snapshot.
Unknown or secret API values remain unknown.

Objective-list coverage differs from objective completion.
Ready for turn-in differs from a completed quest flag and an observed turn-in.
Completed-ID API scope is unknown. These flags cannot prove a character-specific hand-in.
Only observed `QUEST_TURNED_IN` events establish a session turn-in receipt.
Disappearing tasks can be abandoned. Removal never proves completion.
An active repeatable task takes priority over historical completion markers.

## Automatic reminders

The user selected an independent opt-in switch, off by default, with a global three-minute cooldown.
The Main Stage owner alone generates reminders. Settings windows remain read-only consumers of telemetry.
An attempt ledger covers both games and character changes. It persists before provider work starts.
Failures and cancellation retain the cooldown and deduplication receipt.
The existing rolling model budget reserves each actual model request.

Candidates use actual readiness, recent new turn-in events, observed level gaps, or nearby logged tasks after a level gain.
A level gap is a caution, not a proven access restriction.
The reminder never claims an optimal route or invents NPCs, prerequisites, rewards, or coordinates.
Automatic reminders do not trigger remote reference queries.

Eligibility requires fresh live data, the current character, a living noncombat state, speech configuration, and an available conversation host.
Quiet hours, mute, equipment prompts, foreground chat, and other companion interactions prevent dispatch.
The owner checks identity and relevant quest evidence before generation and playback.
Loss of eligibility aborts generation and stops only the owned audio turn.
Late model results cannot revive a cancelled reminder.
Sleep, clock reversal, and deadlines cancel transient work without erasing persisted receipts.

## Validation boundary

Validation uses actual addon Lua, bridge decoding, temporary protocol fixtures, real Vue and Pinia browser tests, and external-boundary provider substitutes.
No personal model request, voice request, or running-game acceptance is required for source validation.
Updated addon modules require a full game-client restart after deployment. The updated bridge also requires restart.
Existing Windows installers retain their earlier source snapshot until a separate release build.
