# DEV-SPEED DS13: the worktree reaper

Plan: meta `docs/plans/DEV-SPEED-PLAN.md`, row DS13 (Jake auto-approved
DS11-DS13, Q26). Worktrees pile up: every plan makes one, and each holds
its own install and build output.

`node scripts/worktree.mjs reap [--dry-run] [--grace=HOURS] [--no-remote]`
removes a plan worktree only when its branch has landed (`git cherry
origin/main` lists nothing, after a fetch), its tree is clean, no process
has its working directory inside (`/proc` on Linux, `lsof -d cwd` on the
Mac; if neither answers, nothing goes), `land` isn't running there, no
`worktree new` is running, and nothing in it changed for 24 h. Then `git
worktree remove` without force, the local branch deleted only while it
still points at the commit it checked, and `origin plan/<slug>` deleted
under a lease on its SHA, only if that remote branch is landed too. The
pre-push lets a delete-only `plan/*` push through without a gate
(`1eac85a`). Anything kept is named with its reason; every run appends a
receipt.

Not done here: running it hourly from each coordinator loop, DS7's links
and a per-worktree queue directory (neither exists yet).

Engine's `AGENTS.md` agent section now points at `worktree.mjs new` and
`reap` instead of the hand-made worktree (J241: below the marker only).
