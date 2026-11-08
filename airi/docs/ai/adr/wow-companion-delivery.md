# Windows companion delivery and local updates

Status: Accepted

Date: 2026-11-01

## Scope

The user approved Windows installation, portable delivery, dependency checks, version matching, backup before updates, and rollback after failed startup.
Real game, personal model, and speech acceptance remains excluded.

The release is `2.21.0`. The application package retains its upstream `0.12.0-beta.5` version.
The release manifest records both values. Companion update ordering uses the release version.

## Packages

The dedicated builder produces an x64 NSIS installer and a portable ZIP. It never publishes them.
Windows publishing is disabled. The runtime also keeps upstream automatic updates disabled.
The installer uses the dedicated `ai.wow.companion` identity and preserves user data during uninstall.
The application defaults to `~/.airi-wow-companion`. `APP_USER_DATA_PATH` overrides that location.
The update helper passes the exact current profile to each launched version.

The release includes both game addons, Bridge 2.15.0, version metadata, and the Windows update helper.
Python 3.10 or newer remains a separately installed prerequisite. The bridge uses standard-library Windows capture and requires no pip dependencies.
The optional Godot engine is absent from this Windows companion distribution. Existing web character renderers remain available.
No model files, private configuration, calibration files, or local bridge logs enter the resource bundle.

`companion-release.ts --manifest-only` writes the resource inventory before the desktop build.
The packaging command checks source resources again before packaging.
The final application inventory runs after executable resource editing and signing. Earlier hashes would describe different executable bytes.
Both NSIS and ZIP receive this final `wow-companion-update.json` inventory.
The manifest contains platform, architecture, versions, executable name, byte counts, and streamed SHA-256 hashes.

## Read-only diagnostics

Settings exposes application, bridge, bundled-addon, and resource checks.
Python checks use the existing executable discovery boundary and a standard-library import probe.
The two bridge health requests use fixed loopback ports. They cannot start a bridge or control a game.
An unavailable bridge remains unavailable evidence, even when the bundled version matches.
The settings page links to the official Python Windows downloads page and existing addon installation guide.
Addon replacement keeps its existing explicit action and previous-addon backup.

## Side-by-side local update

The user extracts a trusted portable ZIP into a new directory, then selects that directory in settings.
The application checks every regular file against the inventory. Extra files, missing files, links, traversal paths, and unsupported architectures fail verification.
Only a strictly newer companion release is accepted. The inventory and resource manifest must agree on both versions.
Checksums detect damage. They do not establish publisher identity.

A verified preview exposes metadata and an opaque plan identifier. Selecting a directory cannot launch it.
The confirmation action captures saved settings, game histories, and chats through the existing backup boundaries.
It writes a portable recovery copy and a separate private journal with exact saved keys and file bytes.
Credentials, model files, send queues, and existing asset records stay outside this rollback scope.
The executable inventory is checked again after the backup and before launching the helper.

The helper runs outside the closing application. It receives a fixed JSON job instead of interpolated shell commands.
The current application runs the helper's validation-only mode before agreeing to quit.
This checks the same path ancestors, profile location, recovery conflicts, and nonce rules as the actual handoff.
It waits at most 60 seconds for the current process to exit, then starts the selected executable with the same profile.
The new application acknowledges only the matching job and executable after normal services and the main Vue renderer become ready.
The renderer must finish mounting and initial routing without a captured Vue error.
The readiness RPC accepts replies only from the designated main window.
A matching acknowledgement within 90 seconds completes the update.

If startup fails, the helper stops only the new process it owns.
It activates the saved rollback journal and launches the previous executable.
The previous application's cold-start backup transaction restores saved data before normal services start.
Rollback success also requires the previous application's matching readiness acknowledgement and cleared recovery journals.
Neither installation directory is overwritten, moved, or deleted.
Conflicting recovery tasks block journal replacement. Failed recovery preserves the checkpoint and reports that attention is required.

The old installation and all recovery files remain available after success.
Future direct launches must use the selected new directory. Existing shortcuts continue to refer to the old installation.
The app does not rewrite shortcuts or switch a system installation behind the user's back.
For an upgrade with this recovery flow, use the settings action instead of directly overwriting the old directory with an installer.

If the computer loses power or the helper is terminated, retain both directories and the checkpoint.
The saved portable checkpoint remains available through Backup and restore. This flow is not an operating-system recovery mechanism.

## Verification boundary

Node tests use temporary files and streamed inventories. Browser tests use real storage and components with mocked Electron IPC.
Helper tests run Windows PowerShell 5.1 against temporary compiled executables, including readiness, timeout, rollback, and path conflicts.
Building the installer does not install it. No personal profile was updated or restored during development.
