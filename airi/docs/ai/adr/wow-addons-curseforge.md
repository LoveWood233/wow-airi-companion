# CurseForge addon center

Status: Accepted

Date: 2026-10-27

The desktop settings include a plugin center for Retail, Classic, and Forever.
The center reads categories and version types from the CurseForge API.
Classic branches retain their distinct API version types under one Classic tab.
An unknown or mismatched version type cannot select an installation file.

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

Sources:

- https://docs.curseforge.com/rest-api/
- https://blog.curseforge.com/introducing-api-key-authentication-for-curseforge-file-downloads/
- https://support.curseforge.com/support/solutions/articles/9000208346-about-the-curseforge-api-and-how-to-apply-for-a-key
