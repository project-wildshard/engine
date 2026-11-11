# worktree new keeps the canonical checkout on origin/main

Jake, 2026-11-10: "If the main checkout of the engine is stale, we
definitely need to get it up to date. That's bad." The canonical checkout
had drifted to 46 ahead and 556 behind origin/main, and every lane's
`worktree new` cloned its files from it.

`worktree new` already fetches origin main under its setup lock. Now it
also fast-forwards the canonical checkout's main to it, but only when that
checkout is on main, has no tracked edit and no commit origin/main lacks;
git refuses a fast-forward that would overwrite an untracked file. A
diverged canonical main is named loudly in the fetch step and left alone:
it is never reset. Test: `test/tooling/worktree.test.mjs`.

J206 Codex review: three MUSTs. The merge now passes `--no-overwrite-ignore`
and `--no-autostash`; a merge, rebase, am, cherry-pick, revert, bisect or
index lock in progress leaves it alone; so does any other process whose
working directory is the checkout itself (worktrees under `.worktrees/`
and this command's own shell don't count). Git has no lock that
serializes a commit started in the same instant with the fast-forward;
the process check is what stands in for it, so an agent working in the
canonical checkout always blocks the follow.
