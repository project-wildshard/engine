# A cooked zone reads its own files, not the page's copies

> Written by: Claude (opus-repacks), 2026-11-26, meta standalone-shardfiles SF4 (done-when of SF8: enter from a local cook
> with no request to an engine `public/` zone path).

Far Reach entered from a local cook (`zone-cook-entry.mjs`, engine 6213e3576) reached gameplay on desktop and phone with no
missing file, but read its far view (`far.json`, `far.glb`, `far-impostor.png`) from the page's `/assets/baked/far-reach/`.
The readers chose the zone path only when the page's byte table listed it, and a cooked zone's mounts are not in that table:
its spawn download lists them at their page URLs.

`zoneFirst` now also asks the download (`useZoneDownloadListing`, lent by `spawnDownload.ts` with `spawnListed`), and the
grid's far source asks `zoneFileListed`, so a cooked zone's own copy wins over the engine-wide one the page still carries
until SF11 and SF12 empty `public/`. A Node bake lends nothing and reads the table only.
