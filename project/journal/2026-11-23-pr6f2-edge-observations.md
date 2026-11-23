# Grid edges read the product's own observations (PR6f2, engine half; opus-compat-w9)

- A product's `world/edge` may carry `edgeObservations` (format PR6f1, exported as `./edgeObservations` in e364d43).
  `folders.ts` admits the field, so engine accepts a file the SDK writes with it. Before this, its strict edge rows
  refused one. `edgeSources.ts` lets the file decide each side: geometry is `ground` unless the file says `void`,
  and water appears only where the file declares it. The registry's guesses (`ground.structures`, `minimap.openWater`)
  stay for a product without the field.
- Built ahead (J475) against shard-format main 6d857d2 linked into the worktree. It lands with the engine's format pin
  to the release that carries the export (0.71.0 or later). The SDK half writes the field only after this ships.
