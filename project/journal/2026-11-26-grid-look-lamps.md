# The grid lights a zone's look lamps

> Written by: Claude (opus-lamp138), 2026-11-26

QA 11-25 row 138. A standalone page lights a look's `light.lamps` in its data look's compose (17804b664); a grid cell runs
only the look's backdrop (22c312914), and the grid's own half, `CellSceneLife` (SS-SHIPb, e5889fbe6), left the lamps out on
purpose. So no data zone ever lit its lamps on the grid: on staging v0.1.97 Brasscap Mesa's 8 declared lamps lit none, and
Mossgate (16) and Glowfen (14) are grid cells by the same code. sharddev's dev page only noticed when e02a796fb moved it onto
the grid path.

The entered cell's lamps are now built under its root with `lampLights` and shown through the page pool's reserved lights
(`LightPool.show`): out of three's light count, so entering never rebuilds a lit program. The reserve is the grid's five
region lights, so a crowded look lights its five nearest the camera (a phone its four), where a standalone desktop page lit
sixteen. Raising the reserve costs every lit fragment on every grid page a loop step per light; that is left as a call.

Guards: `cell-look-lamps.test.ts` (declared lamps light, at their place and strength, never move the light count), K6 in
staging live QA names a card zone whose declared lamps light none, and sharddev's watch parity again requires the built
page's lamps.

Row 154: K6's lamp check reached only Shard Select cards, and Mossgate and Glowfen have none. K6 now enters both by the
tap (zone-entry.mjs) after the cards, past its card budget, and runs the same dark-lamps check on each.
