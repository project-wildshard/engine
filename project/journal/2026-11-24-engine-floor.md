# The cook and a pin refuse a product that needs a newer engine

> Written by: Claude (opus-pr6). Meta FORMAT-PRUNE FP47b; coordinator's gate order (J505).

SDK 0.4.31 builds products that draw right only on an engine whose grid shell reads `look/look` (839c8ba08, v0.1.83).
It stamps that floor in the product, `requires.engine` (format 0.1.0.6, shard-format `./engine-floor`). Here the cook
(`openShardfile`, so every cook job, recook, record pass and `scripts/pins.ts`) and a format-dependency pin
(`scripts/pin-format.ts`) call `checkEngineFloor` with this engine's release: the server bundle's baked
`__ENGINE_VERSION__`, else `package.json` (a release checkout names its tag; main names the last release merged back, so
main refuses a floor until that release's merge-back). The API places a product only after the channel's cook approved
it, so a refused cook keeps it off that grid, and the API recooks it when the channel's cook engine moves.

`scripts/pin-local.ts` (a linked local product) does not check: a local link proves a branch, not a grid.
