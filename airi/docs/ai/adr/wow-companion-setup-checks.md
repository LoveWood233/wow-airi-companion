# First-use setup checks

Status: Accepted

Date: 2026-10-31

## Scope

The user approved configuration checks as the first feature in section 4.1 of the product plan.
Other section 4.1 features require separate confirmation.

The guide now includes a setup card on its home and completion page.
The welcome and finish bubbles offer a button that pauses the overlay to expose that card.
The card checks the selected client, addon files, Python, bridge resources, live character data, chat, and speech.

## Evidence

Local checks inspect files and probe Python without starting a bridge or changing settings.
The game directory remains editable. The saved launcher path provides an initial suggestion when available.
Client metadata must match the selected game. Forever currently requires a 1.60 build.
Addon manifests must list readable Lua files. The installed version must match the bundled version.
Forever requires matching ordinary and Camelot manifests.

Bridge resource presence is distinct from runtime startup. A stopped bridge remains untested.
The live character check requires recent screen observations from the current game profile.
Demo data, paused capture, stale observations, offline characters, and bridge errors cannot pass.
The card displays the character name, realm, and last valid observation time.

Checks use Passed, Failed, Not configured, and Not tested states.
Finishing the guide does not change these results into success.

## Explicit actions

Addon installation requires a button click. Only the selected game's bundled companion addon can be installed.
The main process validates the destination and rejects symbolic links.
New files enter a staging directory. An existing addon moves to Interface/CompanionBackups before replacement.
Failed replacement restores the previous directory. Application shutdown waits for an active installation.
The UI shows the backup path and requests a full game restart.

Chat testing uses the current provider and model, a short fixed prompt, no tools, and no conversation history.
Speech preview uses the current speech service, model, and voice. Playback alone does not pass the check.
The user must confirm hearing the preview. No-sound reports remain failures.
Requests have a 30-second timeout and a cancellation action.
Changing the selection or leaving the page cancels active tests and releases preview audio.
Provider response errors remain generic to avoid disclosing credentials.

## Boundaries

The agent did not send a real paid chat or speech request during development.
Browser tests use a mocked speech provider and real browser decoding of a silent WAV.
Actual audibility remains a user confirmation.
Filesystem installation tests use temporary game directories, never the user's actual AddOns directory.
The real local check only read the Retail installation and probed Python.

The current preview adapter uses the provider's speech request API.
A provider that cannot expose that API reports a test failure. The existing speech settings page remains available for provider-specific previews.
