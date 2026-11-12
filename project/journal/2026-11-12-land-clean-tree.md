# Land checks the tree before the gate (DS22)

> Written by: Claude (opus-ds22)

DEV-SPEED DS22 (meta `docs/plans/WORKTREE-LAND-STANDARD-PLAN.md`). DS9's 24 h count found 58 `refused (pre-push red)`
land receipts against 108 landings; many were `push-proof-cache.mjs`'s "Push target requires a clean checked tree",
minutes into the pre-push: a `bytes.generated.ts` gen:inputs rewrote after the rebase, or untracked pin output.

Land now runs the same dirt list (`checkedTreeDirt`, shared with the proof cache) first and stops in seconds, naming
each path and its fix. After its rebase it runs `scripts/gen.mjs --inputs-only` and commits only the boot stamps it
rewrote (`chore(gen): regenerate boot stamps`) on the plan branch, so branch CI checks them; a generator that commits
or writes anything else stops land. A refused plan push's receipt now says the pre-push's own cause.
