# The grid shell reads its product's level look first

> Written by: Claude (opus-pr6). Meta FORMAT-PRUNE FP47b, engine half (J505).

Before its product admits, engine read the level look (sky, atmosphere, grade, horizon) from the discovery document in two
places: the grid page shell (`gridPageShell`, `gridPageShellLevel`, from `session.ts` and `world.ts`) and a neighbour
cell's backdrop (`hangCellDataSky`). Each now reads `declaredLevel` first: `look/look`'s `level`, then an older
product's `ui/level`, and the discovery's only when the product declares none (the open plots, Mirror Salt, Mossgate
today). The session already had the admitted product (`manifestAdmittedSource`); the backdrop already had the product's
look section.

No look change: today's builds copy `look.level` into discovery byte for byte. `test/fp47b-shell-look.test.ts` hashes
the shell's look and level both ways on every pinned product under `out/` and finds them equal; headless shots of
Driftwood's and Nine Dragon's shell sky and an open plot's backdrop, before and after, are in meta
`project/evidence/format-prune/fp47b/`. Next: sharddev lifts a no-`ui/level` product's look into `look.level` and stops
copying the four words into discovery; then format 0.1.0.5 refuses them there.
