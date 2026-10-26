# Compact Warcraft transfer grid

Status: Accepted

Date: 2026-10-25

## Context

The transfer grid occupies game space. A larger cell increases the grid area without increasing the payload capacity.

## Decision

Both addons default to one physical pixel per cell. The existing 64-column and 64-row format then occupies 64 by 64 physical pixels.

The grid has no outer border or control panel. This size retains all 4096 encoded bits and the existing CRC check.

The desktop calibration input already defaults to one pixel per cell. Saved calibration values remain user settings.

The settings descriptions give the compact command for each game. The descriptions also give the two-pixel option for display chains that blur single pixels.

The bridge can detect the compact grid from a larger configured cell size. This detection retains the configured origin and strict data checks.

## Use

1. Load the updated addon.
2. Use `/wowc compact` in Retail, or `/wowf compact` in Forever.
3. Keep the complete grid visible.
4. Use the status command to read the grid origin.
5. If the display blurs one-pixel cells, select two-pixel cells in the addon and the desktop calibration.

## Validation

The settings browser suite covers both game pages and calibration interactions. Addon and bridge suites cover the grid size and decoding behavior.
