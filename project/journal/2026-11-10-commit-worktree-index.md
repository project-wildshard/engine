# commit.sh from a plan worktree used the canonical index

codex-mock, 2026-11-10: `scripts/commit.sh` run in a J240 plan worktree
updated the canonical checkout's index; it repaired 8 entries by hand. The
script copied and rewrote `<common dir>/index`, which is the main worktree's
index; a linked worktree has its own under `.git/worktrees/<name>/index`.
Both places now take `git rev-parse --git-path index` (DS6's rule for `.git`
paths). The commit lease and the timing ledger stay in the common dir on
purpose: they are machine-wide. A real-worktree test in
`test/commit-entry.test.ts` fails on the old script (`MM selected`).
