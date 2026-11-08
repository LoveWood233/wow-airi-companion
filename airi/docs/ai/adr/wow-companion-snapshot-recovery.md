# Friendly recovery for missing character snapshots

Personal equipment, gold, level, inventory, talent, and quest-log questions require matching current-character observations.
The owner request-context contributor refreshes observations before building the model request.
Missing, stale, foreign, errored, or incomplete snapshots produce friendly recovery guidance instead of a character evaluation.

The Chinese guidance asks the player to enter `/reload` in the game, wait for reception, and ask again.
English and Simplified Chinese messages live in the existing i18n package.
The prompt prohibits technical error codes, stack traces, paths, guessed character facts, and substitution of another character's information.
This is a manual recovery request. It does not claim that reload fixes every underlying cause.

Database questions about recipes, drops, auction prices, and recommendations do not require personal snapshot recovery.
Known zero gold is valid data. Missing gold is not zero.
An explicit historical-equipment question can use an existing selected-character record without a live snapshot.
Historical records retain their source labels and cannot establish current equipment.

Node tests cover request classification, version and identity checks, partial snapshots, missing observations, and zero balances.
Browser tests verify Chinese reload guidance for six personal snapshot topics and prevent old equipment or technical-error leakage.
The normal live-equipment path and historical-equipment path retain regression coverage.
Tests validate the model input policy, not a particular model's generated wording.
