# Addon-owned equipment decisions

Status: Accepted

Date: 2026-11-04

## Decision

The game addon owns equipment assessment. Comparison body v2 includes the assessment and observed numeric differences.
The fragment envelope remains v1. The frame and byte limits remain unchanged.
The bridge validates the data contract. The desktop validates correlation and freshness, then presents the addon conclusion.
Neither consumer recalculates item quality, specialization fit, or stat trade-offs.

The comparison includes `assessment: { verdict, reason }` and `deltas: [{ key, before, after }]`.
Each delta binds to a numeric stat in the two observed items. Missing numeric stats use zero.
Only the addon decides whether the observed differences justify an offer.

The player confirms the actual change inside the game. The desktop notice has no accept or decline action.
After speech ends, its subtitle remains for three seconds. A text-only notice uses the same three-second interval.
Character changes, stale observations, combat, expired offers, and active user conversations cancel pending notices.

## Historical records

Comparison body v1 remains a permanently supported archive input. It retains its original facts and identity.
An archive v1 record has no addon assessment. The desktop displays it as incomplete manual review.
It cannot create a new equipment offer or a live upgrade notification.
Live bridge responses accept only comparison body v2. The archive schema explicitly accepts v1 and v2.
Existing ten-record histories and backup files retain their identity hashes and storage format.

This policy preserves historical observations without retaining the old desktop assessment algorithm.
It is an archive format contract, not a second equipment decision path.
