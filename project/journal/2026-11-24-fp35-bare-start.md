# FP35: a product with no level manifest stands on its world/spawn

> Written by: Claude (opus-wave3), 2026-11-24.

The wave 3 census (shard-format `tmp/opus-wave3/census.ts`) found that 19 pins (17 open plots, Mirror Salt, Mossgate)
have no `ui/level` manifest, so no SDK can lift their start into sections: a local rebuild on SDK 0.4.29 left them as
they were. `declaredStart` returned the discovery document's start for them whole. It now reads their `world/spawn`
(the discovery's spawn only when the product never declared one) and lays their loadout and audio sections over the
discovery's, the same rule a manifest product has. Every such pin's `world/spawn` equals its discovery spawn today
(`test/declared-start-pins.test.ts`), so nothing moves on screen, and FP36 can stop writing the discovery's spawn.
