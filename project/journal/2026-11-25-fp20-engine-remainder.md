# FP20: the packed species catalogue leaves the engine

`looks/speciesBook.ts` (`HullLookBook`, `folderSpeciesCatalogue`, `speciesBehaviour`), geometry's `packedCreatureBodies`
and `folderRiggedHulls` had no production reader: Nalati draws its declared looks through `declarePageCreatures`. Only
tests reached them. Their own tests go; the three tests that borrowed Nalati's packed bears, horses and wolves through
`liveSpeciesWorld.ts` now use the kit world's bear and boar (the bind-inversion test runs over both rigs), and the world
fixture drops Pine's thrall looks, which no test read. The host register moves the six hosts to `dropped`, and the
section-host table keeps `look/rigged-hulls` as an empty root until the format deletes the section.
