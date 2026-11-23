# C2: a world runs and crosses on server packs alone

SHARD-COMPAT C2 asked that the headless host and the worker run a shard and a road crossing from server packs alone. Both readers
already went through `readServerFolder` and the book's packs (E7.3d, GC15, SA47), but no test put a whole crossing on them: the
crossing tests read built products and the in-tree grid bake. `test/dedicated-pack-crossing.test.ts` writes a release-shaped origin
with the cook's own writers (`scripts/server-origin.mjs`: four server packs and the grid pack), deletes the bake folder, and opens
staging's 2-worker table with every room on `readPackFolder` and the road on `readPackGrid`. The GC15 (3) walk then holds: onto
Driftwood's road, held at Nalati's gate on the other worker, back home on one socket. 42 s locally.
