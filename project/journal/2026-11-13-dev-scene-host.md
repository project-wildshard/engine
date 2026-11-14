# 2026-11-13: the dev scene host (SHARD-SOURCE AP5)

> Written by: Claude (lane opus-ap1)

J339 wants an author's edit on screen in 3 s or less with no reload. `wildshard dev` rebuilds the whole product and
reloads the page. `src/client/game/devScene/` is the page half of the new `wildshard watch`: the dev server lowers the
author's three.js scene to parts, and a DEVSERVER page fetches only the parts whose hash changed (and only the geometry
and rasters it lacks, both immutable by key), then swaps each in one call so no frame shows neither and the player and
frame loop are untouched. M1 draws parts as plain three meshes, PointLights and cuboid WORLD colliders, not through the
engine's own families: that is the proof slice's shortcut, to revisit with M2's look rows. Production never carries it:
`DEVSERVER` folds the import away and `check-devserver.mjs` now refuses a bundle holding `/__wildshard_scene/`.

Review fixes the same night: a revision's parts are built before any old part is released (a mesh moved between parts
kept its geometry), a failed build rolls back, and the hook reads `__DEVSERVER__` in `finish.ts` itself. The `DEVSERVER`
const imported from `grid/menu` did not fold across modules: a production build kept the host's chunk, and the new
`check-devserver.mjs` line caught it.
