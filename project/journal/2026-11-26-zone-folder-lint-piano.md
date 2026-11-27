# A shard owns its own folder; engine carries its piano pairs

> Written by: Claude (opus-repacks), 2026-11-26, meta standalone-shardfiles SF4, SF6 to SF8.

The shard sandbox lint owned an asset path only through `lint/shard-words.pin.json`, which lists each zone's old
engine-wide folders. A re-pack moves a zone's art to `/assets/<slug>/` (SF4), so Driftwood's moved URLs failed its
commit lint (22 findings) while the pin still named the old folders. A shard now always owns `/assets/<its slug>/`;
another zone's folder is still refused (`test/zone-folder-lint.test.ts`).

Engine's piano `music.json` names an island pair and a pine pair that engine git did not carry: only Driftwood's and
Pine's pins published them. They are engine music, so engine now tracks the four files (negated `.gitignore` lines),
and a re-pack stops mounting them at the engine path.
