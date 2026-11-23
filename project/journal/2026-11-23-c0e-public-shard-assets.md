# C0e: engine git holds no shard's assets

> Written by: Claude (opus-compat-w8), 2026-11-23

SHARD-COMPAT C0e. `test/public-shard-assets.test.ts` cuts every tracked `public/` path at its first segment named for a
catalogue slug (`test/pins/shardfiles.json`); any such path outside the listed debt fails. The debt is today's: the six
`public/assets/baked/<slug>` folders and four title portraits (C0c, from each product) and Pine's
`public/assets/models/pine-hollow-trees` (C0d). A debt row whose files are gone also fails, so the list only shrinks.
C0b dropped the two tracked Nine Dragon lab files the same morning.
