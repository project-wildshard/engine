# D5-4: 26 shard pins move to shardfiles with author preparation

Meta DOWNLOAD-THEN-C D5-4 and SHARD-PIPELINE SP2 (J259, J262). SP1a
(`0454e718`..`7ed72221`) let the cook take a preparation made on another
renderer, so prepared shardfiles can be pinned without turning CI red on
the next renderer move.

The 28 shardfiles prepared at `7d1dd888` in D5 were no longer on disk,
so they were made again. A `WILDSHARD_PREPARATION_ONLY` preview of
`7e3b3342` (renderer `49a01af1`) served the pinned shardfiles, and
sharddev's `wildshard prepare` recorded each one in phone WebKit: 1,098
programs over 28. Twenty-seven are the pinned shardfiles plus their
author preparation; Nine Dragon is a fresh build of shard-nine-dragon
`815edcc` (the NB8 phone rig). All 28 were packed, uploaded to
api.wildshard.io and checked in the catalogue.

Two are held. Prepared Pine Hollow and Nalati download 63.4 and 69.8 MB
on a phone before control, against ceilings of 50.5 and 41.4 MB: their
recorded fences (741 and 427 files) are wider than the hand-tuned legacy
fences (573 and 227). They stay staged, and their live shardfiles and
pins stay the legacy ones until the fence is fixed or Jake raises the
ceiling. The other 26 were flipped live and `pins.ts refresh` pinned
them (the catalogue's `catalogue-acceptance` row is not a game shard and
is left out, as before). Driftwood and Nine shrank (19.2 and 32.4 MB);
`shard-size-gate --ratchet` latched both.

Proof on this tree: `pnpm build:game` cooks `28 current, 0 stale, 0
none` with all 28 prepared, `26 current, 0 stale, 2 none` as pinned
here. Ring 1's cook-step is green and every server digest is the same.
`loading-card-proof.mjs` on Nine and `--grid`, Chromium and WebKit, 0
faults. New pins and the three new slices are on the `pins` release.
