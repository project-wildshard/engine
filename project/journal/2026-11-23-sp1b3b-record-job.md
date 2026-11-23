# SP1b3b: the record job

> Written by: Claude (opus-compat-w6), 2026-11-23

`recordSidecars(canary, rest, ports)` is the job that fills a host's sidecar
folder. For each stored shardfile whose author preparation is spec 3 on
another renderer, it unpacks the file into a scratch folder, lets the
recorder prepare it in place (the `prepare` port: `wildshard prepare
<folder>`, headless WebKit, on the box sandboxed beside the cook, SP1b5),
keeps the recorded `cook.json` and every mount the original lacks or holds
differently, checks that the cook would take it (`openShardfile` opens it
`cook`), and writes `<sidecars>/<hash>/<renderer>.tar` by rename.

The canary records first and is held to its author preparation with
SP1b3a's `canaryVerdict`. One that differs, unless a person accepted its
recorded `cook.json` hash, holds every other shard and writes nothing; one
whose recorder fails holds them too. A shard already on this renderer needs
no sidecar (`current`), one that has a sidecar keeps it (`kept`), and a
recording the cook would not take is `failed`, so that shard cooks stale.

`test/record-sidecars.test.ts` runs it with a stand-in recorder that writes
what `wildshard prepare` would on the box's renderer: an equal canary opens
the job and both stale shards get sidecars the cook takes; a canary whose
fence differs holds both until its recording is accepted; a recorder that
fails holds the rest.
