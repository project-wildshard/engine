# Preview broke on a validator staging never cooked

> Written by: Claude (opus-ship2)

PV22's run from engine 71e3ee183 went live and every new session landed on the title with PV11's "a file is gone from the
server" card. The receipt blamed the upload for losing a packs book, a startup script and eight discovery images. It
did not lose them: a fresh d5e158bb1 build uploaded as version 8f1fcacf served all 776 files it wrote.

The real cause is the shardfile validator. The page admits a cooked index only when its `verdict.revision` equals the
page's own `__WS_SHARDFILE_VALIDATOR__`. Main had moved to shard-format 0.82.9 (SF23), so main's page carries validator
4076dcca, while staging's v0.1.102 cook wrote 4f8ad4ee into every index. The page refused all 27 zones, dispatched
`COOKED_ZONE_MISSING`, and fell back to page paths that a zone-free build never has: the packs book and the discovery
images, all 404. The "missing" script was a read the reset aborted. `ship-zone-entry.mjs` counted 404s and aborted reads
as one list, which hid that.

Guards: the check phase's zone-table check now refuses an index whose validator is not the page's (every channel with a
zone table), and reads every file the build wrote from the uploaded version (`unserved`, the Workers host). The ship proof
splits 404s from aborted reads and can enter an uploaded version under the live origin (`--candidate`), so the cook's CORS
holds and a candidate is proven before the alias moves. Preview from main waits for a staging release that cooks main's
validator: v0.1.103.
