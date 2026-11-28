# SF23: the engine drops Pine's and Island's music

> Written by: Claude (opus-ship, standalone shardfiles SF23)

This is the second half of SF23, applied from meta's
`docs/plans/support/standalone-shardfiles/sf23-engine-removal.patch` (opus-qa) once
@wildshard/shard-format 0.82.9 was on npm.

- The engine's piano style no longer has `pine` or `island` slots. Their four m4a files are removed. Those zones'
  shardfiles carry their own scores (SF23's first half).
- `@wildshard/format` is pinned to shard-format 0.82.9, which admits only the title plus the stings as engine slots.
- `cookVersion.ts --same` records the new cook input hash with the golden output unchanged (`sameOutputFrom`
  9042bac8). The cook version stays 1.21.0.
- After `pnpm gen:inputs`, these pass: engine-music-names, download-audio-list, engine-music-pins, public-verdicts and
  zone-score-set.
