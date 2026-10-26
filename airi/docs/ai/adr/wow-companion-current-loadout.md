# Current Warcraft equipment snapshots

Status: Accepted

Date: 2026-10-25

## Context

Acquisition records describe bag additions. Acquisition comparisons describe one target slot at that moment. Neither source describes all currently equipped items.

The user wants character equipment available during chat, including after AIRI restarts.

## Decision

The addon captures all 19 equipment slots after login and each new equipment acquisition. Equipment changes also request a fresh snapshot.

The collector reuses public item and tooltip reads. Empty slots and unavailable slots have distinct states. Missing information never becomes an invented statistic.

Each snapshot has a session-local revision, observation time, trigger reason, and ordered slot list. All slots belong to one character session.

Gear fragments use the existing grid and CRC codec. The receiver publishes one snapshot after all fragments pass validation.

Comparison and offer traffic retains priority. A full equipment snapshot takes longer than one acquisition comparison.

Each item has an 8192-byte JSON limit. The complete snapshot has a 196608-byte limit. Explicit flags identify truncated details.

The bridge clears current equipment on character or session changes. Gear fragments cannot refresh the character heartbeat.

The desktop requires bridge 2.11 or later. Both game profiles use the same gear schema with their existing distinct frame magic.

## Storage and chat

The desktop saves the latest equipment snapshot for each local account and character GUID. Each game profile owns its storage file.

This store does not use the ten-entry acquisition history limit. A newer accepted snapshot replaces the character's earlier snapshot atomically.

Chat identifies the character and observation time. Offline equipment remains a saved observation, with an explicit freshness label.

The latest live character takes precedence. A newly logged-in character without a snapshot cannot inherit another character's equipment.

Item names and tooltip text enter chat as untrusted data. Set descriptions do not establish that their bonuses are active.

## Validation

Lua tests cover login, acquisitions, equipment changes, empty and unavailable slots, retries, and transmission priority.

Bridge tests cover complete assembly, out-of-order fragments, expired streams, identity changes, and rejected payloads.

Desktop tests cover persistence, profile separation, character selection, offline context, and the settings equipment display.
