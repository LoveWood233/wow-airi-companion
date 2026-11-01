# CurseForge addon center

Status: Accepted

Date: 2026-10-27

The desktop settings include a plugin center for Retail, Classic, and Forever.
The center reads categories and version types from the CurseForge API.
Classic branches retain their distinct API version types under one Classic tab.
An unknown or mismatched version type cannot select an installation file.
WoW uses `gameId=1` and `classId=1`. Category and project validation use that same class.
The former class ID `447` returned HTTP 404 even with a valid key.
If no version type is saved, a group with exactly one API version type can use it without rewriting settings.
Classic requires an explicit branch when the API lists several. A stale or foreign saved type remains an error.

The main process owns HTTP requests, credentials, filesystem changes, and installation receipts.
Eventa requests use bounded schemas. The renderer receives credential status, never the saved key.
Electron safeStorage encrypts the key before an atomic profile write.
The user configures a client directory and API version type for each game group.

The API key is required for catalog access and authenticated CDN downloads.
API requests use a fixed HTTPS origin. CDN redirects require a validated forgecdn.net HTTPS URL.
Downloads require the authoritative file size and SHA-1 before extraction.
Author distribution restrictions and unavailable download URLs stop installation.
File histories use at most 20 pages. Larger histories use the project's validated latestFiles list, with the same version checks.

The installer accepts TOC-bearing addon folders in supported ZIP layouts.
It rejects traversal, symlinks, Windows device paths, case collisions, executable content, and oversized archives.
It stages complete, CRC-checked files on the game volume before changing AddOns.
Updates require matching project ownership receipts. Unmanaged folders cause a visible conflict.
Backups remain in the application profile, outside the game directory.
Each addon transaction rolls back if replacement or receipt persistence fails.

Required dependencies install before their parent, with a limit of 20 projects and 10 dependency levels.
Dependencies that completed remain installed if a later project fails.
Optional dependencies are displayed without automatic installation.
One mutation lock covers settings changes and installation across all game groups.
On normal quit, network requests abort and an active filesystem transaction completes or rolls back before exit.

The integration adds no runtime dependency. It uses native fetch, existing Valibot, and the existing yauzl package.

## Chat recommendations

The default desktop tool `wow_recommend_addons` searches CurseForge for addon requests and feature questions.
The model supplies the observed or explicitly requested game and a focused feature query.
Common Chinese and English features map to API category slugs. Other queries use the API search text.
The main process combines the first download-sorted and popularity-sorted pages and removes duplicate projects.
It ranks exact names and feature matches before incidental category matches, then total downloads.
It checks at most 20 candidates, four at a time, against authoritative latest-file branch tags.
Each result uses an available release, or a beta when there is no release for that branch.
Up to five verified projects are returned. Compatibility describes the selected client branch; file patch tags remain visible.

The chat opens a recommendation card once, with download counts, file versions, project links, and installation buttons.
The owner can collapse it afterwards. Empty results and query or installation errors remain visible.
Author-blocked projects retain their source links but cannot be installed by this application.
Neither the model nor the card constructs a download URL when the API withholds one.

Recommendations expire after ten minutes and live only in the main process, with at most 20 reports cached.
The renderer sends a report ID and selected project ID, rather than installation paths or file metadata.
Only an explicit Install click invokes installation. The discovery tool has no installation capability.
Settings changes discard the reports. Installation checks the configured branch, current author policy, file metadata,
required dependencies, archive integrity, and folder ownership again through the existing installer.
No game UI automation is needed. Restart the game to load newly installed addon folders.

The opt-in `scripts/wow-addons-live-check.ts` performs read-only acceptance against the real API.
It accepts `WOW_ADDONS_API_KEY` through the environment and prints only public catalog fields.

Sources:

- https://docs.curseforge.com/rest-api/
- https://blog.curseforge.com/introducing-api-key-authentication-for-curseforge-file-downloads/
- https://support.curseforge.com/support/solutions/articles/9000208346-about-the-curseforge-api-and-how-to-apply-for-a-key
