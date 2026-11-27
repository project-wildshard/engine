# A full worktree cap lists rebased lands and day-old clean worktrees

Meta QA 11-26 row 23, opus-pvpage, ported from repo-kit 9f1168d into engine's variant copy. At a full cap,
`worktree new` now also lists a clean worktree whose patches are all on main (a rebased land) and any clean
worktree idle over 12 h with nothing running, each with its keep-copy and remove command; an unlanded or
patch-landed one keeps its branch. Nothing is removed by the script (J358 (4)); an agent runs the command.
