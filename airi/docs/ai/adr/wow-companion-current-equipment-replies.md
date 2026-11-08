# Current equipment in chat replies

Equipment questions must use the selected player's equipped slots rather than generic advice, bag additions, or another character's saved equipment.

The loadout context now prefers a matching live bridge revision over an older saved revision.
Account, character GUID, session, game profile, bridge health, and heartbeat freshness must match.
An incomplete or rejected bridge revision cannot establish current equipment. A newer saved revision is never replaced by an older bridge revision.
Live data includes class, specialization ID, revision, observed time, all slots, and available item attributes.
The equipment receipt time remains null because the bridge does not expose that timestamp.
Saved and previous-session equipment retain their historical labels. Missing data cannot support claims about current equipment.

The main renderer registers an equipment request-context contributor with the existing owner-chat boundary.
For equipment questions, it refreshes profile observations and attaches the selected equipment to that user request.
The request evidence takes precedence over equipment mentioned in older conversation turns or cached context.
Stopping the owner unregisters the contributor. Unrelated conversation does not request a refresh through this contributor.

The prompt requires item-specific evaluations to cite observed equipped item names and attributes.
It also requires an explicit historical or unavailable-data statement when the current session's equipment is not verified.
These instructions guide model behavior. They do not prove a particular model followed them in a live conversation.

Regression tests first reproduced stale saved-data selection and the missing-first-save case.
Node tests cover current selection, foreign identities, stale captures, errors, and saved snapshots.
Browser tests exercise registration, question-time refresh, irrelevant input, and character switching through the real stores.
