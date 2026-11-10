# VITEST-BENCH VB16: shipped inputs load once per file

Plan: meta `docs/plans/VITEST-BENCH-PLAN.md`, row VB16 ("load immutable
fixture inputs once per file, not once per case"; the node:test spike's two
worked examples). Lane `opus-vitestbuild`.

`test/headless-combat.test.ts` re-read a shard's product, every asset byte and
Rapier for each case; `test/dedicated-doc.test.ts` did the same for
Driftwood in each of its 23 cases. Those inputs are immutable: a resident or
room reads them and builds its own world. Each file now keeps the loading
promise per slug, so the read happens once. Every resident and every room is
still created fresh in each case, and no `expect` line changed.

Interleaved pairs (original file copied beside the new one, alternated), one
worker, 2-slot CPU grant, load 10.6–15.8:

| File | CPU s before → after | Wall s before → after |
|---|---|---|
| headless-combat | 11.9 → 8.8, 13.5 → 10.8, 14.1 → 11.7 (−17 to −26 %) | 7.4 → 5.6, 8.6 → 7.0, 9.7 → 8.1 |
| dedicated-doc | 23.4 → 19.1, 22.4 → 21.6, 27.2 → 19.8 (−3 to −27 %, median −18 %) | 14.5 → 11.0, 13.5 → 13.5, 17.4 → 11.7 |
