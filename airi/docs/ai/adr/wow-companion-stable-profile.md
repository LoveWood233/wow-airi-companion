# Stable profile for the Warcraft launcher

Status: Accepted

## Context

Windows can redirect AppData operations for packaged processes. The virtual directory and the normal directory can appear as one merged directory.

The same launcher can therefore expose different saved settings when started from different process contexts. A merged directory listing does not establish database corruption.

## Decision

The Warcraft launcher defaults to `%USERPROFILE%\.airi-wow-companion`, outside AppData and the source repositories.

An explicit `-UserDataPath` takes precedence. An existing `APP_USER_DATA_PATH` remains supported. Normal and development launches use the same selected directory.

The launcher creates the directory and passes its absolute path to the child. It restores the parent's environment after launch.

The main process sets both `userData` and `sessionData` before Electron becomes ready. Browser settings and main-process records then share the selected profile.

Bridge-only launches do not select or create an AIRI profile. The launcher does not merge or import old profile files automatically.

## Existing data

Back up the source before migration. Select one physical profile rather than copying a merged AppData view.

Keep each database's original index, tables, and log together. Recover missing original files from a matching backup. Do not merge unrelated database generations.

The local recovery used the original matching files. It did not change provider values or expose credentials.

## Validation

Isolated launcher checks cover the default path, explicit and environment overrides, development mode, bridge-only mode, and environment restoration.

An isolated Electron profile recovered the saved providers and model selection after closing and reopening. The same profile also passed a launch from the packaged context.

The probe loaded only an empty local page. It blocked remote requests and printed only counts and presence checks.

## References

- [Windows packaged app file-system behavior](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes#appdata-operations-on-windows-10-version-1903-and-later)
- [Electron application paths](https://www.electronjs.org/docs/latest/api/app#appgetpathname)
