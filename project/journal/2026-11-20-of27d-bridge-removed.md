# The product-creatures bridge leaves (ONE-FORMAT OF27d)

> Written by: Claude (opus-of27d, landed by opus-of21-drift4), 2026-11-20

Driftwood's six creature kinds now draw from `platform.skin` look rows (shard-driftwood `rows/creatureSkins.ts`) and
its client plan no longer keeps `population.product-creatures`, so the temporary bridge from 15e54b885
(`runtimeCreatureOwner.ts`, `creatureOwner: 'runtime'`, `test/runtime-creature-owner.test.ts`) has no plan left to
serve. The runtime page's data client installs declared creatures as any client-page shard's does.

Failed first: `test/declared-creatures-runtime-page.test.ts`, a runtime page handed `creatureOwner: 'runtime'` emptied
its declared roster (mode `empty`); with the bridge gone the binding means nothing and the page draws the roster
(mode `full`). It lands once engine pins the Driftwood revision whose plan has no `population.product-creatures`.
