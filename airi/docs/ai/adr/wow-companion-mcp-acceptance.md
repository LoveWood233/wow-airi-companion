# MCP conversation acceptance

Status: Accepted

Date: 2026-10-31

## Scope

The user approved the second feature in section 4.1 of the companion plan.
The guide includes a conversation check below its configuration checks.
The default question asks about Thorium Bars in Warcraft Forever.
This check always targets Forever, regardless of the guide's selected game profile.
It neither changes the active game profile nor reads live character data.

## Evidence

The check uses the selected chat provider, model, and active Character prompt.
It uses the existing LLM runtime and MCP proxy tools through Electron Eventa.
Task tools replace all normal chat and provider tools for this request.
The catalog exposes only `wuxianwow::search` and `wuxianwow::fetch`.
The execution boundary rejects every other tool and allows at most six queries.
Discovery alone cannot pass the query stage.
Only successful model-triggered searches produce query receipts.
The answer must cite at least one returned Wuxianwow page and include the source attribution.
Unreturned Wuxianwow links fail the citation stage.
This checks execution and citation consistency, not semantic correctness of every claim.

The five stages show connection, query execution, Character answer, source links, and speech confirmation.
The answer and matched links appear beside successful tool names.
Raw replies render as text. Matched source links use explicit HTTPS anchors.
Errors use local messages without provider response bodies.

## Speech and lifecycle

Speech starts only after a separate click and successful query and citation checks.
It uses the existing speech store output adapter, selected model, voice, and speech settings.
Both HTTP synthesis and streaming output use the existing browser playback implementation.
URLs and Markdown formatting are removed from spoken text.
Successful playback leaves speech unconfirmed until the user confirms hearing it.

Conversation requests have a 90-second deadline. Speech has a 60-second deadline.
Cancellation, selection changes, and unmount invalidate the run and stop its audio.
An in-flight MCP transport call can continue remotely. Its late result cannot change the check.
Each run owns its receipts, abort signal, and playback group.

Only the latest timestamp and outcome persist in local storage.
The UI labels this record as historical. It never restores live passed stages from this record.
Prompts, answers, raw tool payloads, credentials, and normal chat history stay outside that record.
No request starts on page mount.

## Validation boundary

Automated tests mock external MCP and model transports, not Pinia or Vue components.
Speech tests use a silent WAV from a mocked provider and real browser decoding and playback.
The agent made no paid model or speech request during development.
The user still needs to run this check with personal services and confirm actual audibility.
The excluded real-chain acceptance task remains incomplete.
