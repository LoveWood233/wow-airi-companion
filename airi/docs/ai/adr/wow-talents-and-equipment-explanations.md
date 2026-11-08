# Talent and equipment explanations

Status: Accepted

Date: 2026-11-01

## Approved scope

The user approved committed talent capture, node and ability explanations, explicit equipment comparisons, and pasted plan comparisons.
Forever uses wuxianwow references. Retail uses actual observations and the existing local DB2 query service.
No simulation, talent changes, or automatic equipment changes belong to this workflow.

The user separately approved website talent links, website allocation strings, and explicit node-ID/rank lists.
Retail game import codes remain unsupported until a reliable versioned decoder exists.
An omitted node in a partial list remains unspecified. It does not request rank zero.

## Committed talent evidence

The addon captures the active configuration through the actual trait APIs.
Configuration identity and staged-change checks surround the read.
Repeated node and committed-entry checks reject mixed revisions.
Draft, inaccessible, and unknown configurations cannot publish learned nodes or zero-rank evidence.
Talent changes can interrupt an obsolete transfer before its active data is published.

Session, character GUID, revision, build, locale, class ID, specialization ID, configuration ID, and original capture time accompany observations.
Class, specialization, tree, node, entry, definition, and spell IDs remain separate namespaces.
Website display groups and allocation-string positions never establish trait node identities.

Selected-node coverage does not prove an absent node has zero ranks.
Only explicit stable zero reads supply `knownZeroNodes`.
Purchased ranks differ from active ranks. Plan investment differences use purchased ranks, never granted active ranks.
Unknown values remain null or absent instead of becoming zero.

Independent bounded fragments share background transmission slots with inventory and quests.
Existing character heartbeats and equipment priority remain intact.
The bridge validates complete correlated transfers before publishing them.

## Query and comparison boundary

The page and model tool use independent clients with the same strict query contracts.
Only explicit actions query remote references or local DB2.
Clients reject stale in-flight associations after character or configuration changes.
Displayed prior results retain their original source times and indicate that changed configuration requires another query.

Website strings are parsed by their source server. The returned node IDs establish plan identity.
Recognized URLs require a verified talent path and matching class.
Source adjustments remain visible. They cannot silently replace the user's requested plan.
Exact Forever node mapping requires matching verified client builds.
Unknown or different builds cannot supply an exact mapping claim.

Equipment comparisons require an explicit slot.
Rings, trinkets, main hand, and off hand remain distinct choices.
Slot compatibility cannot prove class, race, level, specialization, or proficiency eligibility.
Weapon pairs and two-hand transitions require additional review. No hidden cross-slot totals are calculated.

Existing nineteen-slot equipment captures retain their original observation times.
A fresh character heartbeat does not make old equipment newly captured.
Catalog items are base references, including estimated attributes where the source says so.
They do not identify the player's bonus, socket, enchant, or other item-instance state.
Missing catalog stats remain unknown. An explicitly observed empty slot can establish zero contribution.
Raw DB2 scaling fields cannot become flat item stats without a verified resolver.

The assistant explains known numerical tradeoffs and described effect conditions.
It cannot infer DPS, stat weights, active set bonuses, proc rates, or an optimal build from incomplete evidence.
Retail raw spell templates retain their unresolved status.

## Chat and UI

Settings exposes current observed facts, reference queries, pasted plan comparisons, and explicit-slot equipment comparisons.
Recorded tool cards validate game, operation, identity, source, and comparison evidence before rendering.
Game and source strings render as text, never HTML or instructions.
The current-player talent context is bounded and excludes staged or expired learned ranks.
An owner-only clock expires its writer independently of bridge requests. Stop clears the clock and rejects late results.
Selected entries require a positive active rank before their spell definitions enter this context.
It requests no proactive response or game action.

## Validation and delivery

Tests use actual Lua, CRC fragments, Python decoding, strict TypeScript contracts, and real Vue/Pinia browser behavior.
Public read-only MCP checks do not use a personal model, voice provider, or running game.
Game deployment and full live acceptance remain separate from source validation.
New addon modules require a full client restart after deployment. The bridge also requires restart.
Existing Windows packages retain their earlier contents until rebuilt.
