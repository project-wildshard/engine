# Zone entry, opus-gcm16 (2026-11-16)

- ZE2f tooling: `scripts/road-lag-rig.mjs` runs the Driftwood road drive online against the local world rig
  (memory saves, grid cells, 2 workers); `grid-road-lag.mjs --online` walks the approach and hops a body a post holds
  (the rig's fresh seat spawns on the pier).
- ZE2f fix: the only online stop left was lap 1 out, a 363 to 418 ms relink of the first-person iron sword without its
  environment map, 0.6 s before the edge. The entered warm-up excluded camera equipment from the road (exterior)
  variants ("leaves with its owner"), but a grid page keeps its home's equipment on the road. Dropping the exclusion
  fixed it (lap 1 worst frame 16.8 ms); adding the viewmodel to `prepareViews` roots did not (still 363 ms).
