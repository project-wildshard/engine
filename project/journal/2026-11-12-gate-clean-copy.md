# The push gate checks a clean copy, and main pushes split (EV1, EV2)

> Written by: Claude

J290 put up to three mode-1 lanes in the one canonical checkout, but the pre-push refused any push while any file
there was dirty or untracked ("Push target requires a clean checked tree", codex-pinefix2 blocked by another lane's
`play.ts`), and a gate that did start type-checked whatever the other lanes wrote while it ran. So mode 1 was one lane.

EV1 (meta WL11): `scripts/push-gate-copy.mjs` gates the pushed SHA in a detached worktree under `tmp/push-gate/`,
built from APFS clones of the checkout's clean tracked files (worktree.mjs's hashed clone) plus node_modules, the tsc
cache and out/, about 4 s to make and 2 s to remove. The canonical checkout always copies; a clean plan worktree still
gates in place. `CLEAN_COPY` turns it off. A gate that regenerates a tracked file names it, since the copy goes.

EV2 (meta WL13, coordinator under J288; Jake may veto): a main push now runs the split gate, static checks plus the
related Vitest files, as a plan branch does. Main's own ci runs the full suite, and the hook starts main-watch on the
SHA (`--after-push` waits for it to reach main and quits if the push lost a race), so a red is reported to the lane
and fixed forward (J249). `MAIN_PUSH_SPLIT` in `scripts/push-local-split.mjs` is the switch. A tag or release push
keeps the complete gate.

A gate killed mid-run (SIGKILL, a closed terminal) leaves its copy; the next gate sweeps every copy whose pid is gone.
