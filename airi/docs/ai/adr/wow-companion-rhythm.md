# Companion rhythm

Status: Accepted

Date: 2026-10-31

## Scope

The user approved quiet hours, scene frequencies, and a proactive model budget.
The user also requested death responses in the active Character voice.
These controls extend the existing chatter settings page.
Manual chat remains independent from these controls.

## Quiet hours and scenes

Quiet hours use the computer's local clock. Start is inclusive and end is exclusive.
Overnight schedules work. Equal endpoints cover the whole day.
The default schedule is 22:00–08:00, with the switch disabled.
Quiet hours stop ordinary chatter, scenery screenshots, and location lore, including their current owned audio.
Suppressed work does not accumulate for later playback.
Event reactions and equipment or group-buff reminders retain their existing switches and mute rules.

Scene overrides start disabled. Zero inherits the current base frequency.
Each scene has separate ordinary and screenshot intervals, from one to sixty minutes.
Reported `none` selects outdoor settings. Reported `party`, `raid`, and `scenario` select instance settings.
Unknown or PvP observations use base settings. Map names do not infer a scene.
Scene transitions restart the full interval, even when both frequencies match.
Combat, death, stale data, and foreground conversations still suppress ordinary chatter and screenshots.

## Budget

One Main Stage owner reserves proactive generations for both game profiles.
The default cap is thirty generations per rolling sixty minutes, with enforcement disabled.
The configurable cap ranges from one to one thousand.
Every attempted proactive generation consumes one reservation. Failures retain their reservation.
Scenery requires two available reservations before capture, then charges vision and answer generation separately.
Location lore, event reactions, and calendar digests also consume reservations.
Fixed phrases, speech synthesis, and manual requests do not consume this quota.
This quota counts generation tasks, not provider billing requests, tokens, or internal tool steps.
Already reserved work can finish when the remaining quota reaches zero.

Reservations contain timestamps only. Browser storage receives each reservation synchronously before generation starts.
Settings windows read this ledger on their one-second display clock.
Restarting, switching profiles, or disabling the cap does not clear recent reservations.
The disabled cap still records usage, so re-enabling it cannot erase the current hour.
Clock rollback retains future timestamps until their original hour expires.
Quota exhaustion discards event opportunities and resets background eligibility. Old work does not replay after quota recovery.

## Death responses

Death events remain eligible even when the observed combat flag still holds at death.
One living-to-dead cycle permits at most one death response.
A new owner observing an already dead character establishes a baseline without replaying death.
Death has higher priority than incidental events. Resurrection discards pending death commentary.
The death and resurrection switches, cooldown, mute, and model quota still apply.
Replies follow the current Character persona, including comfort or fictional faction banter.
Examples include “愿圣光保佑你” and “部落都是废物”. Examples are optional, never fixed loops.

## Validation boundary

Tests cover clock boundaries, scene transitions, no catch-up, quotas, persistence, cancellation policy, and death cycles.
Browser tests exercise real Pinia stores, native storage, and settings controls.
No real paid model or speech request forms part of development verification.
Real game and audio acceptance remains outside this feature's completion claim.
