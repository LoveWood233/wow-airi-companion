# Fixed character JSON archives

The desktop writes `wow-companion-retail-archive-v1.json` and `wow-companion-forever-archive-v1.json` inside its user data directory.
The default Windows directory is `C:/Users/10413/.airi-wow-companion` on this installation.
Each file contains the current accepted equipment, acquisition history, character balances, account totals, level history, and a money journal.
The game addon still transmits observations through the existing grid. It cannot write arbitrary disk files.

## File contract

- `moneyUnit` is `copper`. One gold equals 10,000 copper.
- `goldTotals` contains decimal-string totals across the observed accounts in this game profile.
- `gold` contains per-account and per-character balances and cumulative income and spending.
- `equipmentLoadouts` retains the latest accepted complete loadout per observed character.
- `equipmentHistory` retains the existing acquisition history and its existing retention limit.
- `levelHistory` retains upgrade records, duration milliseconds, and complete, partial, or unknown duration classifications.
- `goldJournal` appends balance changes and income and spending differences between desktop observations.
- `checkpoints` supports restart deduplication. Consumers must not edit it.

Balances describe the last observation of each character. Offline characters are included without claiming current online balances.
Level durations use the existing observation intervals. They do not establish active `/played` time, and unobserved gaps retain unknown durations.

## Journal limits

The first archive observation establishes a baseline. Cumulative historical totals cannot reconstruct historical transactions.
Journal rows can combine several transactions. Each row carries the previous and next observation time, balance, income, and spending.
`occurredAt` and `reason` are null because the current telemetry does not establish exact transaction times, purchased items, or spending categories.
Counter decreases create a reset marker with unknown amounts. Transfers remain part of observed money movement.
The journal is not truncated automatically. A large history increases the archive's size.

## Persistence

Existing validated stores own acceptance of live observations and rejection of demo data. The archive receives their projections after each poll.
Writes occur at most once every five seconds, plus a final normal-shutdown flush. No live combat or location snapshot enters the archive.
Each write uses a temporary file, flushes it, and atomically replaces the fixed JSON file.
Failed writes preserve the previous file and retry. Corrupt journals block replacement and report an error in the application log.
No user credentials or model settings are exported.

On this installation, both files were initialized from existing saved stores before restarting the desktop.
This migration records no fabricated past transactions. New journal entries begin after observation resumes.
