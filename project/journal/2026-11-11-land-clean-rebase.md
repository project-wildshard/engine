# land: a clean rebase goes in (J249)

Jake, 2026-11-10 ~23:35 Cancún: "if CI passes on the branch/worktree and
the merge/rebase is clean with no conflicts then it goes in… they don't
have to re-CI on rebase… we just risk main going red because of edge
cases." And: "no locking… people collaborate together without locks."

So land drops its rerun rule. After the branch's CI is green and main has
moved, a clean rebase (a conflict only in the generated stamps, which land
regenerates, counts as clean) is `carried`: land regenerates the stamps for
the rebased tree and pushes it to main on the branch's green run, through
the split pre-push. No path, harness, clocks or planner rule sends it back
to branch CI. A real conflict still stops with the paths, and the resolved
commit, being new, gets its own branch CI. Main's CI runs after every
landing, and land now prints the rule: if it goes red, the lane that
landed last fixes it forward or reverts it, at once. AGENTS.md says the
same. The classifier and the shard-planner check are gone with their tests;
the same-file, harness and `.github` cases are now tested as carried.
