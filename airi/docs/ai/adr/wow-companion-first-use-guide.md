# WoW Companion first-use guide

Status: Accepted

Date: 2026-10-31

## Decision

The desktop offers a spotlight tour after provider onboarding completes or is skipped.
The offer opens `/settings/wow-guide?tour=auto` through the existing settings-window command.
The settings home lists Getting started as its first entry.
Users can restart the tour or continue saved progress from that page.

The eleven steps cover welcome, character appearance, providers, chat, speech, game connection, chatter, screenshots, MCP, shortcuts, and completion.
The user selects Retail or Forever before starting. The connection step opens the matching settings page.

The overlay uses Reka Dialog for keyboard focus and Escape handling.
A dark mask and an outline mark the current page content. The bubble has Back, Next, Configure, and Skip actions.
Configure hides the modal and exposes a Continue guide control. Users can then edit the actual settings, including provider subpages.
The tour does not change settings, enter credentials, install addons, or invoke model services.

Completing the tour records that the user read it. It does not certify a valid game connection or model setup.

## State and lifecycle

The local profile stores the offer flag, outcome, step index, and game selection.
The active overlay and pause flag remain local to the settings renderer.
The main window offers the tour once. Failed window-open requests leave the offer retryable.
An existing settings window also accepts the automatic-tour query.

Explicit tour actions navigate between pages. Other navigation pauses the tour instead of redirecting users back.
Closing the settings surface hides the overlay. Unmounting retains saved progress and pauses the tour.
Scroll and resize observers update the outline. Missing content leaves navigation available with an explanatory message.

English and Simplified Chinese strings live in the existing WoW Companion locale files.

## Validation

Ten browser tests cover automatic offering, provider-onboarding order, skip persistence, replay, both game routes, configuration pauses, keyboard focus, and narrow layouts.
The targeted run also includes existing chatter and launcher tests. All 32 tests passed.
The desktop typecheck, i18n build, desktop build, and repository lint passed. Lint retained 670 existing warnings.
The root typecheck remained blocked by existing missing dependencies in MediaPipe and a missing vue-tsc command in the browser scenarios package.

No real Electron session was restarted. Restart the desktop app to load the new build.
Use Settings → Getting started to replay it in an existing profile.
