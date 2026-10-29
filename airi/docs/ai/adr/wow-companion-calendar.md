# First-login calendar reminders

The telemetry addons read holidays, player appointments, guild and community events, and RAID_LOCKOUT entries after login and CALENDAR_UPDATE_EVENT_LIST.
They use C_DateAndTime.GetCurrentCalendarTime for the server date. Civil date arithmetic handles month boundaries and leap years.
Calendar month offsets account for the month currently selected in the game's calendar.

The first successful scan of each server day becomes a saved batch for that character and realm in calendarV2.
It contains activities that start today and activities that end tomorrow, with exact server dates and times.
Other ongoing activities and declined or removed invitations are excluded. Private events use GetDayEvent startTime and endTime.
Raid lockouts use GetRaidInfo time and difficultyName. Resets are announced both on the previous day and on the reset day.
Appointments without a distinct ending time do not get an invented end reminder.
An activity that starts later today is described with its scheduled time, without claiming it has already started.
There is no background alarm at the activity's start time. This follows the first-login-only requirement.

Calendar frames share the pixel grid without replacing character heartbeat slots or macro receipts.
The bridge validates dates, actions, identity, field sizes and batch positions.
It publishes a digest only after all parts arrive. Character changes clear the batch.
Stale, paused and demo connections cannot publish reminders. Calendar observations expire after 70 seconds without a frame.

The desktop groups all entries into one character reaction after its current game identity is established.
Combat, death, mute, missing model configuration and busy conversations delay submission.
The local storage key `wow-companion/calendar-seen-v1` retains up to 4096 event receipts.
Official events share receipts by game, account, realm, server date and event. Personal events and lockouts also include the character GUID.
Existing daily receipts continue to suppress official events but do not suppress new personal reminders.
The receipt is written before dispatch. Restarting the app, reloading the game or switching characters does not resubmit official events. Each character gets its own personal digest.
A failed dispatch is not retried automatically. The receipt records an attempt, not proof of audible playback.
Calendar titles are treated as untrusted observations in the model prompt.

The Lua API scan is bounded to 200 events per day and 32 reminder entries.
An incomplete response or an oversized batch remains unavailable and is retried during the login session.
The addon does not treat unavailable calendar data as an empty completed batch.
The API must expose official holidays for the client's region and version.

Source: [Blizzard calendar API definitions](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/CalendarDocumentation.lua).

Validation uses real Lua 5.1 with game API fixtures, bridge frame tests and desktop policy tests.
Live calendar loading and audible playback still require in-game validation after reloading the updated client.
