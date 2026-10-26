# Current Warcraft character names

Status: Accepted

Date: 2026-10-25

## Context

The companion receives character names from live game snapshots. Conversation history and character cards can contain older names.

The user wants AIRI to address them by the latest logged-in character name.

## Decision

The desktop companion selects one current player across the Retail and Forever profiles. The login identity contains game, account, character GUID, and session.

A new login changes the selection. Matching connection events provide initial order across profiles. Without those events, first observation order decides.

Heartbeats, settings updates, and capture recovery do not promote an older login. Connection recovery events do not replace the first connection time.

An unavailable latest login clears the current name. It does not restore another profile's older name. Demo data never provides the user's name.

A dedicated chat context tells the model to use the current exact name. It treats the quoted name as data.

This name takes precedence over names from older messages, memory, and cards. The model uses it naturally, without repetition in every sentence.

Without a current name, the context requests neutral second-person wording. Stopping the companion removes the context and resets its runtime selection.

Event reactions receive the same address instruction. Equipment suggestions interpolate the current name into localized text, including the text-only path.

The suggestion uses the root `wow-companion` translation namespace. Its message, comparison reason, and confirmation text use the same namespace.

Each equipment prompt tick checks the current player. A character switch cancels an older suggestion before another profile update can reuse it.

## Limits

The selection depends on valid live screen observations. Missing connection history limits cross-profile login order to first observation order.

The change controls new model requests and equipment prompts. It does not rewrite previous messages or replace audio that already played.

## Validation

Node tests cover character changes, profile order, recovery, invalid observations, quoted names, cleanup, and equipment prompt cancellation.

Browser tests exercise the real companion store and chat context. They cover event instructions and localized equipment suggestions without voice.
