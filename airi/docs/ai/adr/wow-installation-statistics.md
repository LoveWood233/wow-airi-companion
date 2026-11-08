# Anonymous installation and usage statistics

Date: 2026-11-04. Desktop release: 2.26.0. Independent server release: 1.0.0.

## Decision

The desktop registers a random installation identity with an optional server. A five-minute checkpoint reports cumulative provider-returned token counters.
The server uses Python, WSGI, Gunicorn, and SQLite. It runs independently from the game bridge and the companion runtime.

The first-run disclosure has reporting selected. Collection and networking start only after Continue.
Disable acknowledges the disclosure without collection. Escape and Later leave the installation undisclosed and disabled.
An empty publisher endpoint makes no network requests. Existing profiles also require disclosure after this upgrade.

## Ownership

- `core-agent` emits one usage observation per SDK generation. Its aggregate usage callback remains unchanged.
- `stage-ui/libs/model-usage` emits content-free observations within the owning renderer.
- Every desktop App renderer subscribes and forwards observations through Eventa.
- `CompanionStatistics` in the main process owns consent, identity, deduplication, atomic persistence, scheduling, and network cancellation.
- `WoWCompanionDataHub` validates registration, credentials, monotonic counters, and checkpoint sequences inside SQLite transactions.

Only the main character window mounts the disclosure. Settings can display and change the native reporting state.
Neither renderer state nor ordinary backups contain the installation secret. A transferred installation needs its own identity.

## Data contract

Registration contains a UUIDv4, a random 32-byte upload secret, the companion release version, and the operating-system platform.
The server stores the upload secret hash. It never returns the secret through statistics endpoints.

Checkpoints contain a sequence and nine counters: generation records, records with usage, records without usage, input/output/total tokens, and three field-coverage counts.
Missing token fields remain absent observations. The client never estimates tokens or infers total tokens from input and output.

No prompt, response, screenshot, audio, character data, provider name, model name, or provider API key crosses this boundary.
HTTP transport exposes source IPs to network infrastructure. Application rate limits retain IPs only in bounded process memory.

## Persistence and retries

The main process atomically saves counters and a bounded recent observation-ID set in `wow-installation-statistics-v1.json` under userData.
This file is independent from provider configuration and character archives. Invalid storage stops reporting without overwriting the file.

The client persists the sequence before sending cumulative counters. A lost reply can produce a later sequence with the same counters.
The server adds only the difference from its previous checkpoint. Duplicate or stale checkpoints cannot repeat token increments.
Unchanged checkpoints refresh activity. An endpoint change requires registration at the new destination.

Disabling reporting aborts in-flight requests and invalidates late replies. Shutdown stops timers and waits for pending persistence.
The client does not add an exit upload. Unsent counters remain available for the next periodic checkpoint after restart.

## Deployment and limits

The publisher endpoint lives in `apps/stage-tamagotchi/resources/wow-statistics.json`. Users can override it in settings.
Production endpoints require HTTPS. Loopback HTTP supports development.
The administrator key stays on the server. Docker Compose mounts it as a file secret.

The server runs one process with SQLite WAL and a persistent volume. Administrator sessions use HttpOnly, SameSite=Strict cookies.
The public reverse proxy provides TLS, request buffering, and timeouts. The application does not enable cross-origin access.
Deployment steps and the HTTP protocol are documented in `WOWAddons/WoWCompanionDataHub/README.md` next to the active source tree.

Installation counts are not people counts. Clearing the identity creates another installation. Disabled installations are not counted.
Generation records are not HTTP requests. Tool rounds can report only partial usage.
TTS and ASR interfaces do not provide a common token contract and are excluded.
Daily increments use the UTC receipt date. Offline reports cannot reconstruct the original occurrence date.
Self-reported counters are not a billing or anti-abuse system.

## Validation

Tests cover disclosure, disabling, persistence, missing usage, deduplication, retries, shutdown, HTTP authentication, SQLite transactions, and browser interaction.
A synthetic native-to-WSGI integration test verifies stored totals after a lost receipt and a client restart.
No user model request or configured production endpoint is used by these tests.
The development machine has no Docker. Linux image build and container startup require deployment-host validation.
