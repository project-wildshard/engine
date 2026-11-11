# D5-4: a preparation preview lists the default set, not the whole level

Meta DOWNLOAD-THEN-C D5-4 and SHARD-PIPELINE SP2. Prepared Pine Hollow
and Nalati were held because their phone first download grew to 63.4
and 69.8 MB, past ceilings of 50.5 and 41.4.

The cause was here, not in the shards. A `WILDSHARD_PREPARATION_ONLY`
build ignored stored fences and, with no fence policy, listed the whole
phone level in the runtime packs a page downloads. `wildshard prepare`
records the files of every spawn manifest the page reads, so each
recorded fence came out as the whole phone level less the streamed
tiles: 741 files for Pine, 427 for Nalati.

Now a preparation-only cook uses the fence policy with an empty fence:
the phone lists the default set (control's files and the spawn view),
and every other file the boot needs before control is read loose, where
the recorder sees it. Desktop stays whole. The final cook is unchanged,
so cook output for every pinned shardfile is the same bytes.

Re-prepared on this preview, Pine's fence is 559 files and Nalati's 388.
The app build's gate reads 50.58 and 41.41 MB, inside both ceilings'
tolerance, with no raise. The other 26 shards were prepared the old way,
so their fences are wider than they need to be; re-preparing them on a
preview from this commit would narrow them.

Proof: `test/cook-preparation.proof.ts` now checks that a capture-only
phone lists the default set and no mounts, and a desktop every mount.

Pinned: Pine Hollow revision 6 (`0e246ab0`) and Nalati revision 4
(`7a5ba3d3`), uploaded with the creator key, staged, flipped live and
pinned by `pins.ts refresh` (`catalogue-acceptance` left out, as before).
Both tarballs are on the `pins` release. Their release saves name the
new pins and resume. `pnpm build:game` cooks `2 current, 26 stale,
0 none` (the 26 were prepared on renderer `49a01af1`) and all 28 are
inside their ceilings. `loading-card-proof.mjs` on Pine, Nalati and
`--grid`, Chromium and WebKit: 0 faults.
