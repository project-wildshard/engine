# GC15c: the first page walk across a border online

> Written by: Claude (opus-gc15c), 2026-11-12

The local rig now runs the grid the way staging would with `WORLD_CROSSING=worker`: its origin carries the grid pack (the road has
its 96 strips), and `openRig` takes `crossing` and `workers` (2, staging's table). The proof is
`scripts/grid-crossing-walk-proof.mjs`.

The first walk found a wall the server tests never met, because they set the feet past the edge instead of walking there: a
native cell's baked collision carries the shard's own page walls (`material: 'edge'`), and `nativeBake.ts` left them out only for a
cell held near its player. The dedicated room opens whole solids, so Driftwood still stood inside its walls at x 249.2. A cell that
opens onto the road now passes `road` to its native assembly, which omits those solids. `test/dedicated-road-walk.test.ts` walks a
seat by input through Driftwood's west entryway, along the road and into Sunscar.

Also: the grid part is read by its hash, so a `file:` origin's `.pack.br` is undone (it threw on the header's UTF-8 before).

With the server open, the page leaves Driftwood for the road with no stop (one frame over 50 ms, 267 ms). It then stops 1 m inside
Sunscar: the page's own preparation of Sunscar is blocked by `Compressed texture … lost its allocation after mip retirement`
(`compressedTextureRetirement.ts`), and the player is held on the road. That is the next row.

The rig commit: `server-origin.mjs` takes `--grid=<root>` (default the checkout, where the bake leaves
`out/.app/grid-collision`), and `test/server-origin-grid.test.ts` reads the strips back through a dedicated room's pack reader.

Lint fold: the proof script keeps to the scripts lint (no shadowed names, `Number()` over unary plus).
