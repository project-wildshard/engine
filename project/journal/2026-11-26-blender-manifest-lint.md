# The shard lint reads src/blender/targets.json (opus-held125, meta QA 11-25 row 126)

- `wildshard/no-shard-runtime` exempts a shard's registered Blender sources, and it found the registry only at
  `scripts/blender/targets.json`. The SDK's `build.sh` reads a shard's manifest at `src/blender/targets.json` now
  (sharddev 220ea7e7), so the lint reads that first and the old place as a fallback for one SDK minor.
- Moving the manifest in driftwood, nine-dragon and pine-hollow waits on this reaching their SDK pin: with the old lint,
  their `.mjs` Blender helpers read as primary runtime source and the commit lint refuses them.
- `test/no-shard-runtime.test.ts` lints a scratch single-shard repo with each manifest place: the registered helper
  passes, an unregistered sibling is refused.
