# Warcraft equipment congratulations and quiet interactions

Status: Accepted

Date: 2026-10-26

## Context

The user wants a spoken congratulations when new equipment qualifies for an upgrade suggestion.

The user also wants a short spoken interaction every minute outside combat.

## Decision

The main desktop window owns both features. Settings and floating chat windows do not start another scheduler.

The companion uses the latest logged-in Warcraft character name. Retail and Forever retain separate observations.

Equipment suggestions congratulate the player and mention another opportunity to grow stronger. Primary-stat tradeoffs retain the measured gains and losses.

The suggestion retains its choice buttons and ten-second choice deadline. Choosing Yes still requires the native confirmation inside the game.

Equipment speech uses the active AIRI character's configured speech provider, model, and voice. Without configured speech, the existing text suggestion remains available.

## Quiet interactions

The first interaction requires one continuous minute of healthy, live, noncombat observations from the current character.

Combat, death, disconnection, stale observations, character changes, and disabled or muted companionship reset the interval.

An interaction requires configured speech and an available voice host. Muted output and zero output volume prevent speech.

While chat, equipment suggestions, or other speech occupy the companion, the interaction waits. It does not interrupt those activities.

A new equipment suggestion cancels background interaction audio before it starts its own voice turn.

After an interaction starts, the next interval begins. Accepted interactions remain at least one minute apart.

Missed intervals do not create a queue. Offline time and computer suspension do not produce several overdue interactions.

Four localized messages rotate through adventure plans, a short rest, equipment goals, and favorite scenery.

The messages address the current player by name. They do not claim an unobserved quest, reward, or combat event.

These interactions use speech synthesis directly. They do not require a language-model request.

Speech can wait up to 120 seconds for synthesis and playback. Equipment suggestions also reserve ten seconds before their in-game offer expires.

Combat, foreground chat, or an invalid current observation cancels pending interaction audio. Polling gaps over 30 seconds also cancel that audio.

The existing companion enable and mute settings control these features. No additional preference is necessary.

## Validation

Local tests cover scheduling boundaries, current-character isolation, combat resets, busy periods, and interruption conditions.

Provider requests and audible playback require a live test with the user's configured speech service. Local tests do not establish that service availability.

One authorized live chat test completed on 2026-10-26. MiMo synthesis took 58.82 seconds, followed by 2.28 seconds of playback without trace errors.

That observation supports the longer speech deadline. It does not establish a latency guarantee or a live test of every equipment event.
