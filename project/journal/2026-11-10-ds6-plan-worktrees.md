# DS6: plan worktrees can commit (DEV-SPEED, J221 with J240)

- D27 relaxed in `.githooks/check-index.mjs`: the canonical checkout still
  commits on `main` only; a linked worktree commits only at
  `<canonical>/.worktrees/<slug>` on `plan/<slug>` (rebases allowed). No
  `ALLOW_BRANCH`. Hook tests cover allowed, wrong branch, detached, nested
  path and the canonical checkout on a plan branch.
- Raw `.git/` paths: `pins.ts` writes `info/exclude` through
  `git rev-parse --git-path` (a linked worktree's `.git` is a file, which
  was WT0's `ENOTDIR: .git/info`). Repo-wide markers (Simulator quiet,
  commit-lanes.jsonl, push.log, commit-times.jsonl, Nine Dragon browser
  slot locks) are read from the common Git dir, where their writers
  already put them (`scripts/git-common.mjs`, `agent-time.py`).
- herdr peers list every agent in the repo from any worktree and name
  `.worktrees/<slug>`; the session brief no longer calls plan worktrees
  and plan branches strays. `/.worktrees/` is ignored so the canonical
  tree stays clean (DS11 does the full tool inventory).
- Committed from the first real plan worktree (`.worktrees/dev-speed` on
  `plan/dev-speed`): a first push of a new ref now scans only the commits
  the destination remote's tracking refs lack (`--not --remotes=<name>`,
  name from the hook's `$1`), so a plan branch's first push no longer
  re-scans the whole history (opus-landflow saw > 180 s on 744 commits).
  A URL push or another remote still scans everything.
- J206 review (Codex) fixes: a new ref's scan is narrowed only by the
  `main` tip the destination advertises right now (`git ls-remote` on the
  hook's push URL), never by local tracking refs, which can be stale or
  belong to another push URL. The canonical checkout is Git's own main
  worktree whose Git dir is the common dir (a separate Git dir's parent
  folder never counts), and a rebase in a plan worktree must be of its
  own `plan/<slug>`. The session brief asks herdr-peers for the canonical
  root, so peers outside the current worktree show.
