# Desktop width for the expanded controls

Status: Accepted

Date: 2026-10-26

A saved main window near 204 pixels wide clips the expanded menu's last column and Warcraft entry.

The main window now has a minimum width of 300 Electron logical pixels.

Restoring a narrower saved window increases its width to this minimum. Larger saved widths retain their values.

The existing height and position remain in use. The menu keeps its existing scroll behavior for limited viewport space.

Browser checks cover all four docks, large icons, and Chinese and English labels at the supported minimum width.
