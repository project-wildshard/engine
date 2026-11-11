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

land does the same after every landing (Jake, 2026-11-10 ~23:50 Cancún:
"go to the main checkout, pull main, make sure it's up to date, and then
merge fast forward only in the main checkout"). The main push comes first,
so the canonical checkout is never ahead of GitHub; then land fetches in
the canonical checkout and runs the same guarded fast-forward. Dirty,
diverged, on another branch or busy: a WARNING line and a receipt, never a
reset or a stash, and the landing stands. Tests in `test/land.test.ts`.

Second J206 review: two MUSTs. Only this process and its own shell are
exempt from the process check now, so an agent whose session works in the
canonical checkout blocks the follow even when it is the one running
land. Git offers no lock that covers the merge's own first milliseconds
before it locks the index; the follow takes one last look at the git
states and HEAD right before the merge, and a canonical commit holds
index.lock from before its pre-commit hook to its last write, so only a
hookless writer finishing inside those milliseconds could slip through.
That residue is recorded in WORKTREE-LAND-STANDARD WL7 for a shared
canonical writer lock. If the merge fails after HEAD moved, it says so
loudly instead of quietly.
