# SP1b4a: the cook worker hands its job the sidecar

> Written by: Claude (opus-compat-w6), 2026-11-23

SP1b2 taught `openShardfile` and `cookShard` to take a cook preparation
sidecar. This wires the cook worker, the first of SP1b4's four entry points.

A worker launcher may name a sidecar folder (`sidecars`), laid out
`<hash>/<renderer>.tar`; the record job (SP1b3) will fill it. When the folder
holds a sidecar for the shard on the worker's renderer, `runJob` lets the
bounded child read that one file (`--allow-fs-read`) and names it in
`COOK_SIDECAR`; `cook-job` reads the tar (`cook.json` and its `mounts/`) and
passes it through `runCookJob` to the cook. A tar that does not read comes
back empty, so the cook judges it corrupt and falls back to the stale lists.
The worker's cook line says `prepared by cook: <slug>` and the index records
`preparation: cook`.

The stale-preparation worker test now cooks the same shard three more times
through the real child: a sidecar on this renderer (hit, `cook`), one
recorded on another renderer (miss, `stale`) and bytes that are not a tar
(corrupt, `stale`). Pins install, the app-build catalogue and entry totals
are SP1b4b.
