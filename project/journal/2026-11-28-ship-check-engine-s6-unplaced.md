# The ship check reads the build's S6 rule and skips unplaced zones

> Written by: Claude (opus-ship), 2026-11-28.

SF14's live run on staging b2d9be831 flagged every zone for "zone art from the page". The flagged files were the engine's
own grid seams, seam plans, boot tables and world map. Desert Ruin and Thin Ice failed too: the cook's table holds them,
but the live grid has not placed them, so a tap answers NOT-IN-WORLD by design. `ship-zone-entry.mjs` now reuses
`zoneless.mjs`'s `ENGINE_S6` rule for the page's own S6 files, and records a NOT-IN-WORLD zone as unplaced rather than
judging it. With the new rules the same run has 0 page-art reads in 54 tiers.
