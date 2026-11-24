# The canonical fast-forward names what holds it back

> Written by: Claude (opus-pr6). Meta QA-11-23-b row 51 (J505).

On 11-24 `node scripts/worktree.mjs new` from the canonical engine checkout
stopped at "10 live worktrees (cap 6)". Main already reaps landed, clean, idle
worktrees at the cap (`738764b36`), raised the cap to 10 (`b36bc05fc`) and runs
origin/main's copy of the tool (`954f1ea44`), but none of it ran: the canonical
checkout sat 598 commits behind, because three boot `*.generated.ts` edited on
11-20 made `followMain` leave it alone with the bare words "tracked edits".

The line now names the edited files (three, then a count), so whoever reads it
knows which owner to ask; it still never touches them. Pruned by hand under the
coordinator's rule: `fp31-land`, `fp8-popin`, `sdkqa` (merged, clean, idle).
Test: `test/tooling/worktree.test.mjs`.
