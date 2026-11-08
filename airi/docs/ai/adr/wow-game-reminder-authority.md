# Game reminder authority

Status: Accepted

Date: 2026-11-04

## Decision

The game addon owns deterministic quest selection rules.
The desktop owns notification delivery, speech, receipts, and conversation scheduling.
Both game addons use the same rules. Unknown public values stay unknown.

The existing qlog snapshot remains version 1.
An optional `advice` capability has its own version 1 contract:

```text
advice: {
  v: 1,
  playerLevel: number | null,
  candidates: [{ kind, questID, eventAt: number | null }]
}
```

Kinds are `ready`, `turned-in`, `level-risk`, and `leveling`.
The candidate limit is 83: fifty logged tasks, thirty-two turn-in receipts, and one task after a level gain.
Each state candidate references a retained task entry.
Each turn-in candidate references its exact `QUEST_TURNED_IN` receipt.
Only event candidates contain an event timestamp.
Duplicate kind, task, and timestamp tuples are invalid.

The addon observes `PLAYER_LEVEL_UP` directly.
It does not infer a level-gain event from a changed snapshot or the first login.
Leveling candidates expire after 120 seconds. Turn-in candidates expire after 180 seconds.
Payload trimming removes dependent candidates with their task entries.

## Supported data policy

Snapshots without `advice` remain valid task facts for history, display, and explicit user questions.
They cannot trigger proactive task reminders.
This is an optional producer capability, not a second desktop selection algorithm.
No saved task record requires rewriting, deletion, or replay.

The desktop checks game, character, session, capture time, and matching observed player level.
It correlates candidates with their retained facts. It does not recalculate task difficulty or readiness.
Initial event baselines prevent replay when the desktop starts or reconnects.
Existing reminder receipts and the shared three-minute delivery cooldown remain in place.
The same current-candidate checks run after generation and during speech.

## Related boundaries

Group-buff and calendar observations already originate in the addon.
Their desktop consumers retain correlation, deduplication, preferences, and playback ownership.
This change adds no parallel reminder engine for those observations.
Relationship growth, natural-language memory, screenshots, and SQLite remain desktop responsibilities.
