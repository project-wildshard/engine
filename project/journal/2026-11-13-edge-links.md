# The last links at Driftwood's edge and Sunscar's arrival (opus-relink2)

> Written by: Claude (opus-relink2), 2026-11-13

RP4 after opus-relink: Driftwood's west edge still had a 307 ms frame (3 links) and Sunscar's arrival 150 to 280 ms frames
(about 8 links). The walk probe now names, for every link over 30 ms, the mesh and material three was drawing and how the
new program key differs from that material's nearest existing one (three's `cacheKey`, field by field). Two causes:

- **The edge's 3 links were the retired whole-road meshes.** Once the road's tiles commit, `RoadTileBacking` swaps each
  whole mesh (`grid-asphalt`, `grid-signs`, `grid-deck`) for an empty geometry and keeps it as the tile pool's parent.
  three runs `setProgram` before it reads the draw count, so each empty mesh linked a flat-shaded, position-less variant
  of its road material (no `normal`, no `position`) the first frame it drew, and again whenever the light count moved
  (3 more on the road at x -313). `retireWholeRoadMesh` now also turns off its layers: no camera or shadow pass draws it;
  its pool (a child) still does. Test in `road-tile-backing.test.ts`, red without the layer line.
- **Sunscar's links were its own point lights moving the page's light count.** `lightEmitters.ts` puts plain
  `PointLight`s in a region's content (Sunscar: the braziers' shared site light and the signal light). A grid region's
  pooled lights show through the page's reserved lights (`mirrorInto`), but these counted in three's light hash whenever
  the region showed: 6 -> 7 point lights on the road once Sunscar's world showed, 8 with the signal, and every lit program
  in view linked again (the warm-ups had built them at 6). `LightPool.adopt` takes a mirrored region's plain point lights
  out of the count and shows them through the reserved lights too, up to the reserve; a shadow caster or one past that is
  counted as before. `regionalWorld` adopts before the warm-up (`prepareWorldMaterials`, `beforeWarm`). Review: the
  reserve is shared by every shown region, so an adopted light that finds it full is counted again (it lights; the count
  moves, as before) rather than left dark. Tests in `light-pool.test.ts`.

Local rig (2 workers, crossing on, `--to=sunscar`, the walk leg from Driftwood's west entryway into Sunscar), headless and
muted, cold shader cache, 3 runs each. Worst frame over the whole leg, edge and arrival included:

| | Before (acaa3a88) | After |
|---|---|---|
| Chromium `--use-angle=metal` | 307 ms at the edge, 150 to 280 ms arriving (11 frames over 100 ms) | 33 / 50 / 50 ms, none over 50 ms |
| WebKit | 231 / 207 ms | 59 / 61 / 59 ms, none over 100 ms (2 over 50 ms) |

Links over 30 ms on the leg: 21 -> 0 in Chromium. The probe (`walk-trace.mjs`, GC29's walk plus program attribution) is
in `~/.cache/wildshard/plan-artifacts/grid/leave-driftwood/relink2/`.

Commits: the road meshes first, then the region lights (`LightPool.adopt`, with the full-reserve fallback from review).
