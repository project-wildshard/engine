# DEV-SPEED DS12: identical pins are cloned, not unpacked

Jake, J221: "we want making worktrees to be really fucking fast". Plan: meta
`docs/plans/DEV-SPEED-PLAN.md`, row DS12, its 10 s and 150 MiB targets.

`worktree new` spent most of its time and all of its disk in `pnpm pins`:
every plan worktree unpacked all 28 pinned products again, 1.8 GiB of new
blocks and 12-18 s, though its pins were the canonical checkout's.

Now a full `pins.ts install` that admits every pin writes
`out/.pins-manifest.json`: a key over the pins, asset pins, the installer's
source and the shardfile validation revision (so the lockfile and
`@wildshard/format`), and the sha256 of every file it wrote under
`out/<folder>/` and every mount under `public/`. The digests are the ones the
validator already computed, memoized, so the full install pays little for it.
Any partial, ring or `--from-format` install deletes the manifest first.

The next full install looks for a tree with the same key: this one (a
rebuild with unchanged pins writes nothing), then every other worktree, the
canonical checkout first. It clones each product folder with one
`clonefile(2)` and each untracked mount, then walks every folder (only the
manifest's files, all regular) and hashes every byte across worker threads.
One mismatch removes what it cloned and the full install runs. A mount the
tree tracks is never cloned, only checked, as the full install checks it.

`scripts/apfs-clone.mjs` is the one clone helper. `shardfile-cache.mjs`'s
`publishProduct` used Node's `COPYFILE_FICLONE`, a full copy on macOS; it
clones for real now.
