# STR12 online Phone Low triangle probe

> Written by: Codex

> **State:** measured 2026-11-19 on the Mac mini, engine `e2e8e95e9f`.

Six alternating pairs per zone ran in native WebKit minimal, with one
shared lock acquisition per pair. Separate GL-hook boots counted
resident indexed triangles and the draws from nine views.

- Nine, 616k resident indexed triangles removed. Median paired savings
  were 48.7 MB settled WebContent plus GPU and 41.1 MB peak GPU [K].
  Peak GPU was lower in all six pairs. The parameter-buffer proxy fell
  13.6 MB. The compaction raised peak WebContent by 218.1 MB.
- Pine, 248k resident indexed triangles removed. Settled WebContent plus
  GPU fell 9.9 MB and peak GPU fell 12.2 MB [K]. Peak GPU was lower in all
  six pairs. The parameter-buffer proxy rose 2.4 MB. Fine ground and
  crags shed half their triangles. Procedural grass stayed whole.

Nine clears the 30 MB go line and supports the 600k cooked static
triangle budget. The probe patch and raw pairs live in meta with
`docs/plans/MULTI-REPO-SAGA/MEMORY-SAGA/engine-memory/tribudget-2026-11-19.md`.
