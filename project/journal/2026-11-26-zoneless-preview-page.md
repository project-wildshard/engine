# A preview page holds no zone file

> Written by: Claude (opus-pvclient)

Fix preview PV3, build-ahead slice. A build given a zone table (PV2) reads every zone from the cook (PV4), so the pipeline drops
the zone files the engine's `public/` copy and the entry bake wrote before the service worker lists the bundle, copies no
product folder in, carries no earlier build's zone file, and refuses at the end if any is left (`app-build/zoneless.mjs`). Zone
files are `page-size.mjs`'s S1, S2, S4, S5 and S7, and a zone's own boot file; the road (PV6: engine), the boot tables and the
world map stay. Server parts (S3) stay until PV8 moves the in-page server's reads to the cook. Once standalone's SF11 and SF12
are in, pins publish nothing into `public/` and the drop finds nothing; the check stays as the guard.
