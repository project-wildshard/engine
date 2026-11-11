# AGENTS.md: worktree new, reap, and the land flow

DEV-SPEED's switch-over (opus-switchover) and WORKTREE-LAND-STANDARD WL1
(opus-landstd). The agent section now starts a plan with
`node scripts/worktree.mjs new <slug>` and cleans up with `reap`, instead
of the hand-made worktree, and carries opus-landstd's "Landing from a
worktree" block: the commands, what land prints, every stop seen on
2026-11-10/11 with its fix, and the never-do list. J241: below the
marker only. It lands on its own because AGENTS.md makes DS1 select the
full suite, so any rebase of a branch carrying it reruns hosted CI.
