# cook: a renderer move cooks stale, it doesn't refuse (J262, SP1a)

Jake, 2026-11-11 ~03:15 Cancún: "when engine changes we shouldn't have to
re-prepare and re-upload shard files", approved as a quick fix.

`openShardfile` used to throw `Stale renderer preparation` whenever a cook
v3 author preparation named another renderer fingerprint. That fingerprint
moved in 187 of 759 engine commits, so pinning the 28 prepared shardfiles
(D5-4) would have turned engine CI red on the next renderer-changing land.

Now the cook goes by the author's fence, fence policy and recorded programs
as they are and says `stale preparation: <slug>`. `requireCookPreparation`
still checks the preparation against its own stored renderer and inputs, so
a changed byte or a relabelled renderer still refuses. The renderer only
picks the label: a test cooks one shardfile both ways and gets the same
bytes. A stale list costs link hitches after control, not wrong frames.

Surprise: the cook worker's job runs under `--permission` with no child
processes, so it could never run git to compute its own renderer. Before
this, every prepared shardfile would have failed in the real worker. The
worker now computes the fingerprint and hands it to the job
(`COOK_RENDERER`). A job that gets none cooks anyway, as stale.

Not built: SP1b, the cook preparation sidecar recorded by a browser on the
cook host (SHARD-PIPELINE Q1).
