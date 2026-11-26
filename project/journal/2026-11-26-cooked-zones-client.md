# The client reads zones through the cook's index

> Written by: Claude (opus-pvclient)

Fix preview PV4, first slice, and PV5. A page that bakes a zone table (PV2) reads each zone's index from cooked.wildshard.io at
the table's key and checks it against the table's slug, shard version, cook version and cook hash: never the page's own build,
which is what kept preview off the cook (`placedContent.ts`'s `index.build` check). The index's `objects` table, page path to
object key under `common/` or `cooks/<cookVersion>/` (codex-cookkeys' PV24), goes into `contentBase.ts`, the one leaf every
content read already asks. So the download, the title and the runtime keep their page paths (J138: the member store is keyed by
them) and read the bytes where the cook stored them, and `pageURL` maps a cooked URL back. The manifests become the zone's spawn
rows, as SA48 does for a placed slug. A zone's programs come through the same table (PV5).

A zone whose index is missing or wrong is left out and named in one `wildshard:cooked-zone-missing` event; PV11 (opus-pvpage)
turns that into the "Wildshard was updated" card. Still to come in PV4: the headless entry at 402x874 with every part from the
cook, then an offline reload.

Second slice. The service worker keeps every CORS 200 it reads from the cooked bucket (`ws-<channel>-cooked-v1`, network first),
so an offline reload answers the index, manifests and parts the online visit read; it finds the bucket in the document's own
zone table, as it finds the world stamp. The in-page server's worker gets the page's cooked object table in its start message
and reads a zone's loose files where the cook stored them. A zone table may name its bucket (https, or http on the loopback for
the headless proof), and a manifest row may carry its code list. `cooked-build-fixture.mjs` lays a zoneless build's set-aside
zone files (`WS_ZONE_FILES_OUT`) out as a local bucket, and `test/cooked-zones-browser.proof.mjs` is the 402x874 entry.
