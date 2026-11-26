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
