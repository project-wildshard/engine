# AGENTS.md

> Human-written section (Jake). Empty until Jake writes it; until then the agent section below holds the working rules.

<!-- agents-below: everything under this line is agent-written (Claude, Codex); agents never edit above it (J241) -->

## Agent-written

> Written by: Claude and Codex (agents). Jake gardens this; it may be purged or promoted above the line.

 - AGENTS.md: agents edit only below the J241 marker, never above it; README.md stays humans-only unless Jake says otherwise
 - Every request for work from Jake -> src/scripts/ask-new.sh "<his words>", rules in docs/tasks/asks/README.md
 - Follow-up work is a row in a live plan, never a new ask.

Git hygiene

 - Small Commit early & often.
 - Plan work goes in its own worktree, never on main (J240): `.worktrees/<slug>` on branch `plan/<slug>`.
   Make it from the canonical checkout with `node scripts/worktree.mjs new <slug>`: it branches from origin/main,
   installs offline and clones identical pins in seconds. Run `node scripts/worktree.mjs reap` to remove worktrees
   whose branch has landed (it never touches unlanded, dirty or busy ones).
 - Pushing `plan/<slug>` runs the split pre-push: static checks and the related Vitest files locally; the full suite,
   browser and timing tests run in hosted CI.
 - Land from the worktree with `WS_LANE_NAME=<lane> node scripts/land.mjs`: it pushes the branch, waits for that exact
   SHA's hosted `ci` and `ring-1` to go green, rebases onto main and fast-forwards main. On red or a conflict, fix
   forward on the branch and run it again.
 - `--force-with-lease` only on your own `plan/*` branch after a rebase (land does this itself); never force main.
 - The canonical checkout stays on main. Docs and release pushes from there are a plain `git push origin main`
   through the normal pre-push (the shared push queue is gone, LAND-SIMPLIFY LS7).
 - Use pre-commit & pre-push git hooks for keeping checks/quality/lints etc.
 - Push often after every commit.
 - Every meaningful commit writes a journal into project/journal, the why & informal.

Landing from a worktree (J240; full rules in meta `docs/plans/WORKTREE-LAND-STANDARD-PLAN.md`)

 - When: every code change. Docs-only and release work in the canonical checkout push main directly with a plain
   `git push origin main`. Never land from `tmp/`, a scratchpad or a private clone.
 - Start: from the canonical checkout, `node scripts/worktree.mjs new <slug>`, then `cd .worktrees/<slug>`.
   Commit there by pathspec as usual. One plan, one worktree, one `plan/<slug>` branch.
 - Land: `WS_LANE_NAME=<lane> node scripts/land.mjs` from the worktree. Options: `--timeout=MIN` (CI wait, 60),
   `--rounds=N` (tries at the main push, 5), `--poll=S` (30), `--watch-main` (wait for main's own run),
   `--keep` (keep the worktree and branch). Don't commit while it runs.
 - Land returns as soon as main is pushed (LS5, J258). It then deletes `origin plan/<slug>` and removes the worktree
   and its branch; `cd` back to the canonical checkout. A worktree with uncommitted or untracked files is kept.
 - What it prints, one line per change: `land HH:MM:SS <state> <detail>`. States in order: `start`, `rebased`,
   `stamps`, `pushing`, `ci` (`ci success, ring-1 in_progress`…), `moved`, `carried` (with the reason), `merging`,
   `landed`, `watch`, `canonical` (the canonical checkout's main fast-forwarded to it, or a WARNING and a receipt
   when that checkout is dirty, diverged or busy: it is never reset), `rule` (main's CI and who fixes it), `cleaned`. A stop is one `land STOP <why and what to do>` line. Exit 0: landed or nothing to land.
   Exit 3: landed, but main's own run went red (carried case): fix forward now. Exit 1: stopped. If a `landed`
   line came before the stop, main already moved and only the watch of main's run failed: check main's Actions
   runs by hand; running land again just says `nothing`.
 - Landings, reds, refusals, conflicts and give-ups append a line to `~/.cache/wildshard/lane-receipts.log`
   (`grep ' land '`). Other stops write none, so no receipt doesn't prove land never ran.
 - J249 (Jake: "if CI passes on the branch/worktree and the merge/rebase is clean with no conflicts then it goes
   in… they don't have to re-CI on rebase"): `exact` when main didn't move (main reuses the branch run); `carried`
   when main moved and the rebase was clean (a conflict only in the generated stamps counts as clean: land
   regenerates them): it goes to main on the branch's green run; its main push runs lint, TypeScript and the static checks, no Vitest (LS3). No
   path or harness rule sends it back to branch CI, and no lock is shared between worktrees (one land per
   worktree). A real conflict stops; the resolved commit is new and gets its own branch CI.
 - Main's CI runs after every land. If it goes red, the lane that landed last fixes it forward or reverts it, at
   once (J249). Land prints this rule when it lands.
 - `scripts/main-watch.mjs` reports main's CI (LAND-SIMPLIFY LS5): land starts it to follow the landed SHA. It writes a
   `main green` or `MAIN RED <range>` receipt naming the landers, and messages each lander's herdr pane on red. A
   cancelled run that a newer push replaced is `superseded`, never red. Sweep by hand: `node scripts/main-watch.mjs`.
 - Abandoned worktrees: `node scripts/worktree.mjs reap` (`--dry-run` first). It never touches an
   unlanded, dirty or busy one.

When land stops (each seen on 2026-11-10/11):

 - `land runs on a plan/<slug> branch` / `never in the canonical checkout`: make a worktree with `worktree.mjs new`.
 - `commit or drop tracked changes first` / `a rebase-merge is in progress`: commit, or finish/abort the rebase.
 - `rebase … failed and git rebase --abort did not restore`: the worktree is mid-rebase. `git status`, then
   `git rebase --abort` by hand, before anything else.
 - `land already running in this worktree (pid N)`: wait for it; one land per worktree.
 - `push of plan/<slug> … failed` (pre-push red): the failing check is printed above it. Seen: lint, a stale
   stamp, timing records, an HTTPS remote using another GitHub login (403: use the SSH remote), a fresh clone with
   no pins exclude block (run `pnpm pins` in the canonical checkout). Fix forward, commit, run land again.
 - `origin plan/<slug> holds commits this worktree never had, so git refused the lease`: someone else pushed your
   branch (LS4: land pushes under `--force-with-lease --force-if-includes`, no records of its own). Fetch, rebase
   your commits onto `origin/plan/<slug>` and run land again; or start a new worktree with a new slug and
   cherry-pick your commits. Never force over it.
 - `rebase onto main … conflicts in: <paths>`: `git rebase origin/main`, fix those paths, `git rebase --continue`,
   run land again. A plain both-sides edit of only `renderer-revision.json`/`validation-revision.json` land fixes
   itself; a delete or rename conflict there still stops.
 - `Generated stamp does not match`: `node scripts/gen.mjs --inputs-only`, commit the stamp, run land again.
 - `gen.mjs --inputs-only failed after the rebase` / `could not amend`: commit only the two stamp files by hand,
   then run land again.
 - `main push of <sha> failed and main did not move`: branch CI was green, but the main pre-push (the split gate on
   the rebased tree) refused. Its failing check is printed above; fix forward.
 - `hosted CI is red for <sha>`: the stop names the blocking jobs; `quarantine (n)` reds never block. If main's
   run of the same tests is red too, it isn't yours: wait for main's fix, then run land again. A one-off timing
   miss (a file over the 60 s cap, not your code): `gh run rerun <id> --failed`, then run land again. Otherwise
   fix forward on the branch.
 - `no hosted ci/ring-1 run … after 5 min`: run `gh auth status` first (a failing `gh api` looks like pending
   CI). Then check GitHub Actions: `ci.yml`/`ring-1.yml` must run on `plan/**`.
 - `hosted CI … not finished after 60 min`: run land again; it picks up the same SHA's runs.
 - `HEAD moved …`: you committed while land waited. Run land again to land the new HEAD.
 - `main kept moving for 6 rounds`: each round is a lost race on the main push (the `moved` lines). Run land again.
 - Exit 3 (`main's hosted run is red`): main is red for everyone. Fix forward in the same worktree at once.

Never:

 - push main by hand from a worktree (`git push origin HEAD:main`): code lands only through land; the canonical
   checkout's docs and release pushes are the one plain `git push origin main`;
 - force main, or force anything but your own `plan/*` branch, and then only `--force-with-lease` (land does it);
 - `--no-verify`, `SKIP_*`, `ALLOW_*` or `WS_LAND_MAIN_PUSH` by hand (land sets it on its own main push);
 - commit in the canonical checkout off main, or in someone else's worktree; remove a worktree by hand (`reap`).

Shared checkout

 - Many agents work here, git add only for new files, use git commit -- <filespec>
 - Never git add -A / . / -u, never git commit -a, never bare git commit.
 - Never stash, checkout, restore or delete what you didn't author.

Githooks

 - pnpm install will install the hooks.

Docs / Repo shape

 - docs/ is living: edit in place, keep it true. See docs/plans for all the plans.
 - project/ is for history. See project/archive for the archives.
 - Code in ./src/ etc.
 - Top level directory is thin & lean.
 - Dev commands, layout, code rules in docs/dev.md
 - Scratch goes in ./tmp/<task>; delete it when done.

Code rules

 - In the test suite, No LLM, no claude, no herdr.
 - Every Chromium launch passes `--use-mock-keychain` and `--password-store=basic` (else a macOS keychain dialog opens).
