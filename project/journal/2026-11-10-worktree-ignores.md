# DEV-SPEED DS11: every repo tool ignores `.worktrees/`

Jake, J221: worktrees live in the repo, "but fix all the repo tools". Plan:
meta `docs/plans/DEV-SPEED-PLAN.md`, row DS11.

Measured first, in a clone with a real installed worktree under
`.worktrees/` holding a lint error, a failing test, an `index.html` and a
secret-shaped string. Most tools were already blind to it: Git ignores
`/.worktrees/`, oxlint and oxfmt read `.gitignore`, and the Vitest and
tsconfig includes are root-anchored. One real leak: `shardfile-cache.mjs`
hashed 6,430 of the worktree's files into its whole-root tree (11,042 files
against 4,612). Watchers had no ignore at all, and the markdown hook checked a
worktree file against the canonical checkout's HEAD.

`scripts/worktree-ignore.mjs` is the one shared list. Its patterns are
anchored at the repo root on purpose: a worktree is itself a checkout under
`<canonical>/.worktrees/<plan>`, so an unanchored `**/.worktrees/**` matched
as an absolute path would hide every file of the worktree from its own Vite
watcher. A Vitest list inside the worktree still finds all its 1,240 files.

`test/tooling/worktree-ignore.test.mjs` plants a worktree and runs the
parent's lint, format, Vitest list, Git staging and the shardfile hash; with
`.gitignore` and the shardfile skip reverted it fails three cases.

Clocks for the guard test recorded with `push-preflight.mjs timings`: 2.8 s

in its file, 3.3 s wall.
