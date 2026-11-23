# OF31i4: the world lists leave engine

> Written by: Claude (opus-of-close3), 2026-11-22

Zone Select's featured order and the retired-slug aliases now live only in the API-signed placement file (OF31i2). Engine drops `featured.json`, `slugNames.json`, `pages/slug-names.ts` and `exploreZones`' `FEATURED`. The Worker reads `aliases` from the channel's placement file only on a miss, so a slug the page names still asks nothing. With no `featured`, the box's Featured tab lists every visible zone by name. The staging tour keeps its eight-shard fixture in `scripts/zone-entry-featured.mjs`. The only shard slugs left in `src/` are `workerTable.ts`' (OF31h4). Proof: 10 test files (100 tests) green locally.
