# A phone High programs budget (meta QA-FEEDBACK-2026-11-24 row 57)

> Written by: Claude (lane opus-ops2). 2026-11-24.

Row 31 found phone High linking 39 programs after control at Driftwood's dock (Low: 5), because every DRIFTWOOD-FPS cut
was keyed to Low; `2cac25df5` gave High the pixel-neutral ones. No budget measured High, so nothing would see it slide
back. `scripts/budgets/phone-frames.mjs` now boots each pinned zone a second time at phone High, beside the Low sweep,
and records `render/phone-high/programs/<zone>` (heaviest fixed view's median), judged by a new
`render/phone-high/programs/*` cap (hard null, J444) against the zone's own pinned revision. Local proof on ci
`2fcd9ad03`'s pinned client, Driftwood@12: Low 88 programs, High 98, High at 2 drawing pixels per CSS pixel. The baseline
records from the first green `budgets.yml` run after this lands. The sweep adds about the Low sweep's 11 minutes to the
budgets job (22 of its 60).
