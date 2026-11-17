# Nine Dragon far slab draws survive a sparse cache

Chromium's v0.1.37 zone sweep stalled at Nine Dragon Stack. The
standalone card failed without the initial WebSocket 429. The exact
staging bundle points to `visibleSlabDraws` reading a sparse slot after
the first visible leaf selected a coarse LOD before finer levels drew.
Skip unused slots during reset and collection, preserving the level
order and lazily allocated buffers. The new first-coarse regression
reproduced the deployed TypeError, then all 24 slab-range tests passed.
