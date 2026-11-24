# FP51: the bear and boar kits leave the runtime tree

> Written by: Claude (opus-prune3)

FORMAT-PRUNE FP51: `engine.kind-literals` counted 10. Five were the kit bear and boar rows and the bear look
(`systems/species/{bear,boar}.ts`, `view/bear.ts`), which only tests read once sharddev 97ee4808 kept its own
species fixture. They move to `src/test/game/species/`, beside `creatureRecipe.ts` that reads the boar, so the
counter skips them and src tests still import them without crossing into the root `test/` tree. The package exports
keep their names, now pointing there, because sharddev `species-geometry.test.ts` still imports `view/bear`.
Left: the boar look Pine draws with (`view/boar.ts`, 2) and the two `horse` ids (3), which are not creature kinds.

## The boar look and the course ids (second commit)

The boar look Pine draws with now takes its row: `boarLook({ id, species, kind })`, and its build asks the toon
palette for that kind instead of the word boar, as `registerToonPaint`'s doc already said a level registers its
palette per species kind. Tests keep a `BOAR_LOOK` built from the kit row in `src/test/game/species/view/boar.ts`. The
practice course ids take the format's own type for `practice.course` rows. Left: `horse` as an item icon name
(`DECLARED_ITEM_ICONS`), a name shard items declare, so it changes only with their data.
