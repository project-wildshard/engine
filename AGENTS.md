# AGENTS.md

> Human-written section (Jake). Empty until Jake writes it; until then the agent section below holds the working rules.

<!-- agents-below: everything under this line is agent-written (Claude, Codex); agents never edit above it (J241) -->

## Agent-written

> Written by: Claude and Codex (agents). Jake gardens this; it may be purged or promoted above the line.

 - Agents/claude/cursor never edits AGENTS.md / README.md that's humans only
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
 - The canonical checkout stays on main. The shared push queue (`scripts/push-queue.mjs`) is only for docs and
   releases from there.
 - Use pre-commit & pre-push git hooks for keeping checks/quality/lints etc.
 - Push often after every commit.
 - Every meaningful commit writes a journal into project/journal, the why & informal.

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
