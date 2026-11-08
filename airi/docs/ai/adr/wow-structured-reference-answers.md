# Structured Warcraft reference answers

Status: Accepted

Date: 2026-11-01

## Scope

The user requested structured reference answers for the companion.
The implementation uses recorded wuxianwow MCP results and the existing shared chat widget registry.
It adds no provider, API credential, dependency, or storage schema.

Supported entity kinds are items, recipes, quests, NPCs, instances, and maps.
Supported calls are `search`, `fetch`, `item_usage`, `recipes`, `quests`, `npcs`, `instances`, and `atlas`.
Other servers, creative tools, and other fetch families keep their generic presentation.
The Retail DB2 database remains a separate component. This change does not connect it to chat.

## Evidence and normalization

`stage-shared/wow-knowledge` owns the parser, domain types, link validation, and build metadata reader.
The parser accepts supported MCP envelopes, recorded JSON text, and JSON-LD entity graphs.
Every entity needs a typed identity and a source title. Fields remain plain text.
The reader bounds payload depth, entry counts, field lengths, and section lengths.
Clipped or partial results retain a visible notice and source link.

Links accept only public HTTPS URLs on `wuxianwow.com`.
A conflicting entity URL becomes the known identifier's canonical link and marks the result incomplete.
Explicit evidence for another game is rejected. Missing fields do not become guessed facts.
Temporary quest givers, map marks, and drops remain marked as third-party evidence.
Approximate locations and incomplete source records retain their limitations.

The view always identifies the source as `无限图鉴 wuxianwow.com` and the game as Chinese WoW Forever.
Dataset build, snapshot creation, row modification, auction collection, and query receipt are different fields.
An entity's first-seen build cannot supply the current dataset build.
An unknown build stays unknown. Query receipt time never means that source data is current.

## MCP boundary

`WowReferenceRuntime` wraps the existing external MCP transport.
It preserves returned records and adds source evidence to successful supported calls.
Only an advertised `wuxianwow::stats` tool supplies optional build metadata.
Restricted acceptance transports that advertise only search and fetch receive no extra calls.
Other servers and unsupported tools receive no metadata calls or envelope changes.

Concurrent reference calls share one build probe. Successful metadata is cached for five minutes.
The probe waits at most two seconds. Failure has a 30-second backoff and cannot suppress a returned entity.
Removing the advertised stats tool invalidates pending probes as well as cached evidence.
Results from a previous tool catalog generation cannot repopulate that cache.
Entity facts themselves are not cached by this adapter.
The proxy also rejects malformed JSON and non-object arguments before forwarding them.

## Chat presentation

The shared built-in widget reads the actual tool result, not a model-authored card payload.
A matching predicate restricts the widget to supported calls. Other MCP results retain their previous card behavior.
Finished reference calls reveal their group and row once. Manual collapse remains effective for the same call.
Loading, success, no matches, transport failure, and invalid data have separate presentation states.
The existing raw-result switch and explicit rerun action remain available.
Rendering and expanding a card do not request a model or fetch another entity.

The existing recorded tool result carries the evidence. Reloading a conversation rebuilds the same card without network calls.
The shared renderer serves the chat surfaces that already use this registry.
English and Simplified Chinese strings live in the new `wow-reference` namespace.

## Answer policy

The existing request-scoped knowledge context now distinguishes search summaries from entity details.
It asks the model to fetch a selected typed identifier, preserve ambiguity, and cite returned pages.
It keeps temporary evidence and missing data explicit. It never claims that the local DB2 service was queried.
This policy does not replace acceptance of a real model's final prose and spoken answer.

## Verification boundary

Fixtures were captured through read-only wuxianwow tools on 2026-11-01.
Selected large relation arrays are shortened in fixtures while their original source counts remain available.
Tests cover the parser, proxy transport, recorded result normalization, widget registry, and real browser rendering.
Browser tests use real Vue and Pinia. Only external provider or IPC boundaries are mocked when required.
No personal provider credential, model conversation, voice request, or game process is used for validation.

This task updates source and the desktop build. Previously generated Windows release files remain their original release snapshot.
