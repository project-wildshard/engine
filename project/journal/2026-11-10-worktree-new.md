# DEV-SPEED DS12: `node scripts/worktree.mjs new <slug>`

Jake, J221: "we want making worktrees to be really fucking fast". Plan: meta
`docs/plans/DEV-SPEED-PLAN.md`, row DS12.

One command makes `.worktrees/<slug>` on `plan/<slug>` from `origin/main`:
fetch, `worktree add --no-checkout`, then each tracked file whose blob and
mode match a clean file of the canonical checkout is an APFS clone of it, git
writes the rest, and `git status` must come out clean. Then a frozen offline
`pnpm install`, `pnpm pins`, the herdr pane name and the land steps.

Surprise: Node's `COPYFILE_FICLONE` makes a full copy on macOS (the file's
APFS private size equals its size) and `COPYFILE_FICLONE_FORCE` fails with
ENOSYS. The clone runs `clonefile(2)` from one Python process instead. The
same flag is how `pins.ts` and `shardfile-cache.mjs` "clone" today, so their
copies are real copies too.

Five creations on the laptop: 20.0-25.4 s, median 24.2 s; without pins
6.1 s. Unique disk at ready, measured by APFS private size: tracked tree
0.3 MiB (du says 85.5), node_modules 0.2 MiB (du 282), and pins 1.8 GiB
(`out/` 1,416 MiB plus 380 MiB of mounts in `public/`), because `pins.ts
install` re-extracts every product. Making identical pins a clone or a no-op
is what is left of DS12's 150 MiB bound.

J206 Codex review: four MUSTs, all fixed. A clean `git status` doesn't prove
bytes or modes (filters, eol, `core.filemode=false`), so every clone is now
hashed raw against its blob and mode-checked, and files with a checkout
conversion are never cloned. Sources are opened without following a final
link and must be regular files (`fclonefileat`), and assume-unchanged and
skip-worktree paths count as dirty. The lock is a hard link of a file that
already names its owner, released only by its owner, taken over only from a
dead or 10-minute-old holder. Tracked hooks must resolve inside the worktree
and be executable, or setup takes back its worktree and branch (the branch
only while it still points at the base).

Re-measured after the fixes: 15.4 s on a quieter machine (checkout 3.0, install
1.2, pins 10.2); tracked tree 0.4 MiB unique.

Clocks for `test/tooling/worktree.test.mjs` recorded with `push-preflight.mjs timings`.

Second J206 pass: three more MUSTs, fixed. A failed clone check now deletes
every clone (a name with a newline is never cloned, since `hash-object
--stdin-paths` is line-based); `core.autocrlf` is read as a bool (`YES`, `1`);
and an abandoned lock is no longer taken over at all, because no takeover is
race-free without a process-held lock: the refusal names the lock and the
`rm` that clears it.
