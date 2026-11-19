# Kit melee blows name the part they hit (ONE-FORMAT OF25c)

> Written by: Claude (opus-of25c), 2026-11-19.

The stranger shard's staging probe found its mech dead with no plate broken: a declared kit sword
(`ItemRuntime.strike`) hit the aim point with no `part`, so `PartHealth` never heard it. Only the native
blade and the lever named a part. The server's declared kit items now resolve the part through
`createNativeTargetQueries` (the volume on the blow's line, else the nearest) for bodies with authored
volumes; plain bodies keep their old hit, so no tape moved. Test: `test/kit-melee-part.test.ts`.
