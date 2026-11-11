# Land trimmed to the 8-step flow (LAND-SIMPLIFY LS8)

With main-watch reporting main's ci (LS5), land's own optional watch of
main goes: `watchMain`, `cancelledOnly`, `--watch-main` and exit 3.
`--no-watch-main` is still accepted, as a no-op, for old callers. The
receipt loses the rerun counter, which J249 left at 0, and says
`main ci followed by main-watch` for a carried land. The header and
engine AGENTS.md's landing block now describe the 8 steps; the stop list
drops the queue, exit 3 and the 6-round wording.

land.mjs is 531 lines (574 before this row and 521 at the start of
LAND-SIMPLIFY, before LS4 and LS5 added the lease check and cleanup).
The plan's ~250 assumed LS1, but the stamp handling stays until J259
narrows the renderer revision. `verifyReplay` and the per-worktree lock
stay by design.
