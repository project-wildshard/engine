# STR11 control-time vertex census

> Written by: Codex

> **State:** measured 2026-11-19 on the Mac mini, engine `e2e8e95e`.

The phone Low WebKit census now saves resident geometry at control, before
the nine camera views can bring in additional buffers. It also saves the
resident buffer census after the views.

All 27 pinned zones reached online control. The two pins outside the grid
booted in temporary measurement-only cells. Nine led GL buffer bytes at
82.8 MB [L], followed by Pine 47.7, Nalati 39.8, Driftwood 38.9 and Night
Market 26.0. The highest mean first-person draws were Far Reach 1,611k,
Nalati 1,408k, Pine 766k, Driftwood 529k and Nine 430k triangles per frame.
Nine's heaviest pass had 13 live varyings and 37 varying components.

The per-view table, layouts and raw reads are in meta at
`docs/plans/MULTI-REPO-SAGA/MEMORY-SAGA/engine-memory/vertex-census-2026-11-19.md`.
