# AGENTS.md

> Human-written section (Jake). Empty until Jake writes it; until then the agent section below holds the working rules.

<!-- agents-below: everything under this line is agent-written (Claude, Codex); agents never edit above it (J241) -->

## Agent-written

> Written by: Claude and Codex (agents). Jake gardens this; it may be purged or promoted above the line.

 - AGENTS.md: agents edit only below the J241 marker, never above it; README.md stays humans-only unless Jake says otherwise
 - Every request for work from Jake -> kit/scripts/ask-new.sh "<his words>", rules in docs/tasks/asks/README.md
 - Follow-up work is a row in a live plan, never a new ask.

Git hygiene

 - Small Commit early & often.
 - **Own hunks of a shared file (HOW-WE-BUILD WL17):** make a patch against HEAD containing only your hunks, then run
   `scripts/commit.sh --patch <patch-file> "<message with Assisted-by trailer>" -- <literal-files...>`.
   The existing command builds its private candidate, runs installed hooks (including commit-msg), commits only
   declared paths and preserves peer working bytes/stages. Do not hand-roll private indexes or commit-tree calls.
 - Every meaningful commit writes a journal into project/journal, the why & informal.

One way onto main (J422, Jake 2026-11-18; replaces J400, J404, J336's one land per plan and J290's mode-2 land; MacBook)

 - **The rules on one capped page:** meta `docs/flow/RULES.md` (`~/projects/games/project-wildshard-meta`). This
   section holds only engine's commands; a rule that disagrees with the page is wrong here.

 - **Every row, plan row or one-line fix, reaches main the same way:** commit, rebase, the push gate (lint, types,
   related tests, about 74 s), push main, and move on to the next row. No plan-branch push, no full suite in the lane,
   no queue. Main's hosted `ci` runs the full suite once per tip.
 - **A plan:** one lane, one plan, one worktree: `node scripts/worktree.mjs new <slug>`, `cd .worktrees/<slug>`, commit
   each row there by pathspec, then `WS_LANE_NAME=<lane> node scripts/land.mjs`. Land rebases onto origin/main,
   commits regenerated boot stamps, pushes main through the ordinary pre-push (marker `WS_LAND_MAIN_PUSH=push:<sha>`),
   rebases and pushes again if it loses a race, and starts main-watch. The worktree stays for the next row; after the
   plan's last row run `land.mjs --done` to remove it. Don't commit while it runs.
 - **A one-line fix with no plan:** in the second clone `~/projects/games/wildshard/engine-quickfix` (J323), never in
   `~/projects/games/wildshard/engine`, which stays clean for worktrees: `WS_LANE_NAME=<lane> node scripts/main-push.mjs
   -m "<subject>" -m "<body + Assisted-by>" <file>...`. It commits by pathspec, syncs main without a rebase or stash,
   pushes through the same pre-push and retries a race. On a conflict it uncommits your files and prints the `--onto`
   command that finishes it.
 - **The push gate** (`.githooks/run-checks.mjs`, split gate EV1/EV2): static checks plus the related Vitest files in a
   clean copy of the pushed commit (`scripts/push-gate-copy.mjs`), so other lanes' dirt neither refuses your push nor
   reaches the checks. Browser, timing and slow files run on main's hosted `ci`. A tag or release push keeps the full
   gate, except a release that only stamps the version and adds notes over a cut main's `ci` proved (meta FAST-RELEASE
   FR6): its branch `ci` reuses that run and runs the docs lane plus the release readers (`scripts/ci-selection.mjs`
   `RELEASE_READER_TESTS`), and its tag push reuses both runs (`scripts/release-gate.mjs`). If the gate regenerates a `*.generated.ts` your change feeds, it names the file: run `pnpm gen:inputs` and
   commit it with your change.
 - **A red main is fixed forward, never reverted (J422 wave 2):** main-watch writes `main green` or `MAIN RED <range>`
   naming the pushes, and messages each one's herdr pane. The push it names fixes it forward at once; nobody else stops.
   A cancelled run that a newer push replaced is `superseded`, never red. Sweep by hand: `node scripts/main-watch.mjs`.
   A `main AMBER <sha> <file> <ms>/<budget>` receipt (J295): green, but that file is over budget; fix it the same day.
 - **At most one full local run at a time**, for a release or to name a red: `pnpm test:fast`.
 - **The Mac mini lands the same way (J443, meta FLOW-SIMPLE FS23):** `land.mjs` defaults to push mode on every
   machine; `--local` (the full local gate) is gone (FS23) and `--hosted` too (FS5).
 - **`test/pins/` changes (J375)** reach main through `land.mjs` from a plan worktree or `main-push.mjs` from
   `engine-quickfix` (FS18), both through the push gate; the pre-push (`.githooks/pin-provenance.mjs`) refuses a hand
   `git push`. Escape hatch when truly stuck: `ALLOW_PIN_PUSH=1`, said in your receipt.
 - **Budgets (J444, meta BUDGET-CAPS):** hard caps live in `budgets/caps.json`, each naming its J-number (only Jake's
   word moves one); baselines live in `budgets/baselines.json`, written by `node scripts/budgets/cli.mjs`, never by hand.
   A pin lane runs `cli.mjs record --run <budgets.yml run id>` after its pin's first green main run and commits the file.
   An engine feature that grows a budget runs `cli.mjs declare <key> --why "<feature>"` in the same commit. `cli.mjs check
   <measures.json>` prints the table. A `main BUDGET regressed` receipt is a fix row for its pusher, never a red main.
 - **Local cross-repo proof on the mini (LOCAL-LINK, M1):** from repo-kit,
   `WS_LANE_NAME=<lane> node kit/cli/main.ts local init`, then `local link
   --consumer sharddev --production-live v0.1.2 --reason "<purpose>"` with
   the same lane environment reserves that consumer by receipt. Link the
   canonical main checkouts; repo-kit `docs/local-development.md` owns
   peer compatibility and restoration. Run the consumer's normal check.
   To try an engine or SDK worktree with zero waiting (J475), add
   `--provider engine=<worktree>` (or `sdk=`) to that link: a plain
   symlink, no pack, package.json and the lock untouched; `local unlink
   --consumer <repo>` restores it. To test an unpublished built shard, run `node scripts/pins.ts install
   --from-dir <canonical-shard/built-product-directory>` here, then its
   cook/journey proof. Before main-push, restore the consumer with `local
   pinned --consumer sharddev --production-live v0.1.2` and restore engine
   products with `node scripts/pins.ts install`. Push/land/release refuse
   local shard provenance. After pushing, run `node scripts/shard-check.ts
   --baseline <full-pushed-sha> [--shards shard-dunes,...]`; HEAD is the
   candidate, all seven shards are the default, and both legs are bounded
   to twenty minutes. Keep its receipt and run URLs; a regression means
   fix forward on main. This check runs outside main-push's shared lock.
 - **Escape hatches (J381):** a hook's `SKIP_*`/`ALLOW_*` variable may be used when a hook blocks legitimate work;
   name it and the reason in the receipt and commit body, and fix or report the hook.
 - The renderer and validation revisions are computed live from source; nothing stamps them into git (LS1, J250).
 - Land output: `land HH:MM:SS <state> <detail>`; a stop is one `land STOP …` line that names its fix. Exit 0: landed or
   nothing to land; exit 1: stopped. Landings and stops append to `~/.cache/wildshard/lane-receipts.log`
   (`grep ' land '`).
 - Abandoned worktrees: `node scripts/worktree.mjs reap` (`--dry-run` first). It never touches an unlanded, dirty
   or busy one.

Never:

 - push main from a worktree by hand (`git push origin HEAD:main`): a worktree's commits reach main through `land.mjs`;
 - push a `plan/*` branch;
 - force main; `--force-with-lease` only on your own `plan/*` branch;
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
 - **Wire and save freeze (WIRE-STABILITY WR14, declared 2026-11-19 under J432):** a wire change is a lock diff
   (`@wildshard/wire` in shard-format: a new minor, `wire check`, then the engine pin); a save change is a `v`, a
   migration and a pin (`saves.lock.json`, `pnpm check:saves`). `check:wire` and `check:saves` run in the push gate
   and CI static; `test/contract-cross.test.ts` plays HEAD against `@wildshard/wire-released` (the last released minor).
 - Every Chromium launch passes `--use-mock-keychain` and `--password-store=basic` (else a macOS keychain dialog opens) and `--mute-audio` (Jake, 2026-11-13); spread `KEYCHAIN_ARGS` from `scripts/chromium-keychain.mjs`, which carries all three.

Agent tooling

 - Claude Code and Codex load the same tooling from one source (meta MULTI-AGENT-TOOLING): skills in `.agents/skills/`, hook scripts in `.agents/hooks/`, hooks declared once in `.agents/hooks.json` (this repo's own in `.agents/hooks.local.json`). `pnpm agents:sync` writes the rest; never edit `.claude/settings.json` hooks, `.codex/hooks.json` or `.claude/skills` by hand. repo-kit stamps it: `node ../repo-kit/scripts/agent-sync.mjs --from ../repo-kit`.
