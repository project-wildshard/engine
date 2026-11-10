# A delete-only push of plan/* branches skips the push gate

J240 lands a plan by fast-forward from its worktree; afterwards the lane
deletes `origin plan/<slug>`. That push sends no commit, yet the pre-push
ran the complete local gate (a deletion-only push selects `full`), so lanes
deleted landed branches through the GitHub API instead (meta DEV-SPEED,
"What is left before the switch-over").

`run-checks.mjs` now exits early when every pushed ref is a deletion of
`refs/heads/plan/<slug>`. Deleting any other ref, or a deletion pushed
together with an update, keeps the gate. The outgoing-commit and changelog
checks already skipped deletions.
