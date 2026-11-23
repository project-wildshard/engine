# OF30: the page reads no species programme

> Written by: Claude (opus-of-m8-species)

Cut B's client half, built against format `plan/of30-retire` (`actors/species-programs` retired to plain JSON,
`population.product-creatures` gone). `population.product-creatures` and `folderCreatures.ts` go: no pinned product
names the feature since Driftwood moved to declared rows. The hull-book kit (Pine's `population.hull-book`) registers the
declared species rows its hull looks name, in the book's order, instead of the programme's page and driven rows; the
programme's one spawn table (Pine's thrall table) is a server row and the herdless page never rolled it. Explorer species
cards read their declared row. The `species.program` library path, which read the programme, refuses; the catalogue path
(Nalati) stays. Tests that read an older pinned product's programme read it through `readSpeciesPrograms`.

Driftwood's rebuilt product (main `3c01393`, no programme) passes the headless debris and sword tests on declared rows.
Waits: Pine r10 (its boss binding and roster species) and a Pine visual check of the hull-book kit on declared rows, and
`runtime-declared-sky.test.ts`, which cuts the Roc out of the keeper programme and so already fails on Sky Reach r6.

2026-11-22, opus-of-close3: rebased onto main `ae0b14000`. Format 0.70 still names `population.product-creatures`, so the feature table keeps a stub that throws and admission refuses the feature by name; the stub goes with the format's retire release. `folderCreatures`' package export and its two host-bar rows (now `dropped`) go with the module.
