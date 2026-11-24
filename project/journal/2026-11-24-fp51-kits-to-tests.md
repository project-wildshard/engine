# FP51: the bear and boar kits leave the runtime tree

> Written by: Claude (opus-prune3)

FORMAT-PRUNE FP51: `engine.kind-literals` counted 10. Five were the kit bear and boar rows and the bear look
(`systems/species/{bear,boar}.ts`, `view/bear.ts`), which only tests read once sharddev 97ee4808 kept its own
species fixture. They move to `src/test/game/species/`, beside `creatureRecipe.ts` that reads the boar, so the
counter skips them and src tests still import them without crossing into the root `test/` tree. The package exports
keep their names, now pointing there, because sharddev `species-geometry.test.ts` still imports `view/bear`.
Left: the boar look Pine draws with (`view/boar.ts`, 2) and the two `horse` ids (3), which are not creature kinds.
