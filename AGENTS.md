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
 - Two ways to work, no in-between (J290, Jake 2026-11-12, replaces J240's per-row landing). The lane's brief names
   the mode; a unit with no mode named is mode 1 if it is one row or one fix, else ask the coordinator.
   1. **Small or urgent unit** (one row, one fix, a queue-jumper): work and commit straight on `main` in the canonical
      checkout (`~/projects/games/wildshard/engine`), by pathspec. Then `git pull --rebase origin main` and a plain
      `git push origin main` through the normal pre-push. No worktree, no land.
   2. **A whole plan or half a plan:** its own worktree, `node scripts/worktree.mjs new <slug>` (`.worktrees/<slug>`
      on `plan/<slug>`, from origin/main, offline install, pins cloned, about 5 s). Commit there and push
      `plan/<slug>` as often as you like. Land with `scripts/land.mjs` (below) only when the plan is complete, at a
      major milestone, or once a day for a multi-day plan. Never land per row. `node scripts/worktree.mjs reap`
      removes worktrees whose branch has landed (never unlanded, dirty or busy ones).
 - Mode 1's pull is `node scripts/main-pull.mjs`, not `git pull --rebase` (which refuses while any lane has an
   unstaged edit here). It replays your commits onto origin/main and moves only the paths main changes; if one of
   those is another lane's uncommitted edit it stops and names it: wait and run it again, never stash, restore or
   commit its files (BUILD-MAX EV1, meta WL11).
 - Mode 1's pre-push gates the pushed commit in a clean copy (`tmp/push-gate/<sha>-<pid>`, about 5 s,
   `scripts/push-gate-copy.mjs`), so other lanes' dirty and untracked files neither refuse your push nor reach the
   checks (EV1). It runs the split gate (EV2, J288): static checks plus the related Vitest files, browser, timing
   and slow files left to main's hosted `ci`, about 70 s. The hook then starts main-watch on your SHA; on `MAIN RED`
   you fix forward at once (J249). The switches, one line each: `CLEAN_COPY` in `scripts/push-gate-copy.mjs` and
   `MAIN_PUSH_SPLIT` in `scripts/push-local-split.mjs`. A tag or release push keeps the full gate. If the gate
   regenerates a `*.generated.ts` your change feeds, it names the file: run `pnpm gen:inputs` and commit it with
   your change.
 - Pushing `plan/<slug>` (mode 2) runs the split pre-push: static checks and the related Vitest files locally; the
   full suite, browser and timing tests run in hosted CI.
 - `--force-with-lease` only on your own `plan/*` branch after a rebase (land does this itself); never force main.
 - The canonical checkout stays on main. Mode-1 code, docs and release pushes from there are a plain
   `git push origin main` through the normal pre-push (the shared push queue is gone, LAND-SIMPLIFY LS7).
 - Use pre-commit & pre-push git hooks for keeping checks/quality/lints etc.
 - Push often after every commit.
 - Every meaningful commit writes a journal into project/journal, the why & informal.

Landing from a worktree (mode 2; J290, LAND-SIMPLIFY J249/J258; meta `docs/plans/WORKTREE-LAND-STANDARD-PLAN.md`)

 - When: a mode-2 plan only, at completion, at a major milestone, or once a day for a multi-day plan (J290); never
   once per row. Never land from `tmp/`, a scratchpad or a private clone.
 - Start: from the canonical checkout, `node scripts/worktree.mjs new <slug>`, then `cd .worktrees/<slug>`.
   Commit there by pathspec as usual. One plan, one worktree, one `plan/<slug>` branch.
 - Land: `WS_LANE_NAME=<lane> node scripts/land.mjs` from the worktree. Options: `--timeout=MIN` (CI wait, 60),
   `--rounds=N` (tries at the main push, 5), `--poll=S` (30), `--keep` (keep the worktree and branch). Don't commit
   while it runs.
 - The flow, in 8 steps:
   1. One land per worktree (its lock); worktrees never wait on each other. The tree must be clean but for the
      boot stamps (`src/client/game/boot/{audio,bytes,versions}.generated.ts`) and this tree's own pin outputs;
      anything else stops land in seconds, naming each path and its fix (DS22).
   2. Rebase first if main is already ahead, run `gen:inputs` and commit the stamps it rewrote on `plan/<slug>`
      (`chore(gen): regenerate boot stamps`, DS22), then push `plan/<slug>`. Land rewrites it only when this branch's
      reflog reached origin's tip, under a lease (LS4); the split pre-push runs (static checks, related tests).
   3. Wait for that exact SHA's `ci` to go green.
   4. If main moved during CI, rebase. Any conflict stops, and the resolved commit needs its own branch CI.
      A clean rebase carries the green run (J249).
   5. Push the SHA to main, never forced. `exact` (main didn't move) runs no more checks; `carried` runs lint,
      TypeScript and the static checks, no Vitest (LS3). A lost race rebases and retries, at most 5 tries.
   6. Fast-forward the canonical checkout when it is on main and clean; otherwise a WARNING and a receipt.
   7. A `landed` receipt; `scripts/main-watch.mjs` follows main's own `ci` and reports it (LS5).
   8. Delete `origin plan/<slug>` and remove the worktree and its branch; `cd` back to the canonical checkout. A
      worktree with uncommitted or untracked files is kept.
 - The renderer and validation revisions are computed live from source, in a checkout and in an installed engine
   alike; nothing stamps them into git (LS1, J250).
 - Output: `land HH:MM:SS <state> <detail>`, states `start`, `rebased`, `stamps`, `pushing`, `ci`, `moved`,
   `carried`, `merging`, `landed`, `canonical`, `watch`, `rule`, `cleaned`, and `retry` (a fetch lost a ref lock to
   another git; land waits and tries again, up to 4 times); a stop is one `land STOP …` line.
   Exit 0: landed or nothing to land. Exit 1: stopped; if a `landed` line came first, only the cleanup failed.
 - Landings, CI reds, refusals, conflicts and give-ups append a line to `~/.cache/wildshard/lane-receipts.log`
   (`grep ' land '`). Other stops write none, so no receipt doesn't prove land never ran.
 - Main's CI runs after every land; if it goes red, the lane that landed last fixes it forward or reverts it, at
   once (J249). main-watch writes `main green` or `MAIN RED <range>` naming the landers, and messages each
   lander's herdr pane on red. A cancelled run that a newer push replaced is `superseded`, never red. Sweep by hand:
   `node scripts/main-watch.mjs`.
 - Docs and release pushes from the canonical checkout are a plain `git push origin main` through the normal
   pre-push (its docs-only path skips the suite). There is no shared push queue (LS7).
 - Docs-only fast path (EV9): a push of only AGENTS.md or `docs/**` Markdown runs lint, format, the asks,
   `check:parity` and any Vitest file naming the doc as a string, locally and on `ci`, which skips its shards once an
   ancestor's code run is green. A doc code reads (CHANGELOG.md, via the build) still runs full: `scripts/push-selection.mjs`.
 - Abandoned worktrees: `node scripts/worktree.mjs reap` (`--dry-run` first). It never touches an unlanded, dirty
   or busy one.

When land stops (each seen on 2026-11-10/11):

 - `land runs on a plan/<slug> branch` / `never in the canonical checkout`: make a worktree with `worktree.mjs new`.
 - `commit or drop tracked changes first` / `a rebase-merge is in progress`: commit, or finish/abort the rebase.
 - `rebase … failed and git rebase --abort did not restore`: the worktree is mid-rebase. `git status`, then
   `git rebase --abort` by hand, before anything else.
 - `land already running in this worktree (pid N)`: wait for it; one land per worktree.
 - `push of plan/<slug> … failed` (pre-push red): the failing check is printed above it. Seen: lint, an HTTPS
   remote using another GitHub login (403: use the SSH remote), a fresh clone with no pins exclude block (run
   `pnpm pins` in the canonical checkout). Fix forward, commit, run land again.
 - `this worktree is not clean before the gate` (DS22): each path is listed with its fix. Commit it, move it under
   `tmp/`, or drop it. Untracked pin output (`public/assets/gpu/<shard>/`, `public/programs/`): run `pnpm pins` in
   the worktree, or ignore that pin folder in `.gitignore`. The receipt is `STOP tree not clean …`.
 - `push of plan/<slug> … failed`: the receipt names the pre-push's own cause (`refused by the pre-push: …`).
 - `origin plan/<slug> is at X, which this worktree's branch never reached`: someone else pushed your branch.
   Fetch, rebase your commits onto `origin/plan/<slug>` and run land again; or start a new worktree with a new slug
   and cherry-pick your commits. Never force over it.
 - `rebase onto main … conflicts in: <paths>`: `git rebase origin/main`, fix those paths, `git rebase --continue`,
   run land again.
 - `main push of <sha> failed and main did not move`: the static main pre-push refused (lint or TypeScript on the
   rebased tree). Its failing check is printed above; fix forward.
 - `hosted CI is red for <sha>`: the stop names the blocking jobs; `quarantine (n)` reds never block. If main's
   run of the same tests is red too, it isn't yours: wait for main's fix, then run land again. A file over its
   60 s budget is AMBER, not red (J295): a `::warning::`, green. It is red only at 2x (120 s) or after it has been
   amber on main for 24 h or 12 main runs (thresholds in `scripts/test-amber.mjs`); fix that file, never rerun
   it away. Otherwise fix forward on the branch.
 - `no hosted ci run … after 5 min`: run `gh auth status` first (a failing `gh api` looks like pending CI). Then
   check GitHub Actions: `ci.yml` must run on `plan/**`.
 - `hosted CI … not finished after 60 min`: run land again; it picks up the same SHA's runs.
 - `HEAD moved …`: you committed while land waited. Run land again to land the new HEAD.
 - `main kept moving: 5 tries`: each try lost the race to another push (the `moved` lines). Run land again.
 - A `MAIN RED` message from main-watch: main is red for everyone. Fix forward in a new worktree at once.
 - A `main AMBER <sha> <file> <ms>/<budget>` receipt (J295): main is green, but that file is over its budget. The
   coordinator hands it out as a queue-skipping fix row the same day, before it turns red.

Never:

 - push main from a worktree (`git push origin HEAD:main`): a worktree's commits reach main only through land; the
   one plain `git push origin main` is from the canonical checkout (mode-1 code, docs, releases);
 - make a worktree and run land for a single row or fix (J290): that is mode 1, straight on main;
 - force main, or force anything but your own `plan/*` branch (land does it);
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
 - Every Chromium launch passes `--use-mock-keychain` and `--password-store=basic` (else a macOS keychain dialog opens) and `--mute-audio` (Jake, 2026-11-13); spread `KEYCHAIN_ARGS` from `scripts/chromium-keychain.mjs`, which carries all three.

Agent tooling

 - Claude Code and Codex load the same tooling from one source (meta MULTI-AGENT-TOOLING): skills in `.agents/skills/`, hook scripts in `.agents/hooks/`, hooks declared once in `.agents/hooks.json` (this repo's own in `.agents/hooks.local.json`). `pnpm agents:sync` writes the rest; never edit `.claude/settings.json` hooks, `.codex/hooks.json` or `.claude/skills` by hand. repo-kit stamps it: `node ../repo-kit/scripts/agent-sync.mjs --from ../repo-kit`.
