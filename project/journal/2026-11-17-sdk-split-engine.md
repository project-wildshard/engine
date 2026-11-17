# SDK-SPLIT in the engine (SP5)

> Written by: Claude (opus-sdksplit3)

- SP5a: vite 8.3.0 -> 8.3.8 (peer and dev pin), hono 4.13.13 -> 4.13.19
  and @hono/node-server 2.1.5 -> 2.1.8: the fixed releases for the npm
  audit findings a fresh `@wildshard/sdk` install reported through the
  engine's exact pins (meta SDK-SPLIT SP-NE3 follow-up). Lockfile only
  otherwise; lint, typecheck and the hono-serving tests pass.
- SP5a to SP5c: the engine names format's laws instead of keeping copies.
  E434 refuses re-exports, so each old engine path keeps its names as
  typed aliases (`export const x: typeof law.x = law.x`, `export type`),
  as `world/BakedTerrain.ts` already did, or as an empty subclass for a
  class (`Rng`, `Noise2D`, `GrassField`, `TreeGrid`). Moved: seeded RNG,
  noise, terrain field, road constants, forest placement (wrapped: tints
  become `THREE.Color`), grass field, collider rows/pose/placement
  (wrapped: three's `Matrix4`/`Quaternion` from format's numbers), the
  stored geometry channels and whole-piece partition, the interact data
  half, `compileQuestTable`, `ItemCatalogue` (wrapped, typed to the
  engine's rows), headless sections, `ROAD_SKY`, `FAR_CLIFF_FLOOR` and
  the mover pose. Dead `placeUndergrowth`, `DecisionLog` and
  `decodeTreeRecords` went (Pine Hollow keeps its own undergrowth).
- SP5d: `src/shared/engine/format-laws.test.ts` replays format's RNG
  golden through the engine's `Rng` and sim streams, and checks forest
  and collider placement through the engine wrappers (and into Rapier)
  give format's numbers bit for bit.
