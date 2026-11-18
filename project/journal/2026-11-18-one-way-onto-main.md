# One way onto main (J422, meta FLOW-SIMPLE FS2, opus-flow)

The seven-day audit found lands reaching main 31% of the time with a 16-minute median, lanes queued behind each other's
12-minute full local suites, and main red about as often with the full gate as without it. Jake's J422: every row goes
onto main the way a one-line fix already did, through the 74-second split pre-push, and the full suite runs on main only.

`land.mjs` gains `push` mode, now the default. From a plan worktree it rebases, regenerates the boot stamps, and pushes
main with `WS_LAND_MAIN_PUSH=push:<sha>`. The hook treats that like any main push: the split gate (static checks and
related Vitest files in a clean copy). There is no full-gate queue, no plan-branch push and no Actions wait; a lost race
rebases and pushes again. Land starts main-watch itself, so the hook skips its own watcher for this marker. The worktree
and branch stay for the next row; `--done` removes them after the last.

`pin-provenance` accepts the push marker from a linked plan worktree on the same terms as J400's local marker: J422 is
the one way for every row, pins included, and main's hosted ci judges them.

`--local` and `--hosted` stay, and the hook keeps the `local`, `exact` and `carried` branches, because lands already
queued run their worktree's old `land.mjs` and push through the new hook after their rebase. FLOW-SIMPLE FS5 deletes them
once no old-mode land is queued.
