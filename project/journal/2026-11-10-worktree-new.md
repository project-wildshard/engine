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
