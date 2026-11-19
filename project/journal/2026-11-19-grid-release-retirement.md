# Grid releases can retire a shard

MMO-SERVER MS9a. The signed staging release at serial 116 retired
`_template`. The running grid rejected the release before preload because
the watch required every shard that the old grid had opened. The VPS
could start the same bundle after a restart.

The watch now reads the grid from the verified next bundle and selects
the shards that its signed release names. Explicit cell lists still
require every configured shard. The world starts grace only after the
next catalogue and all required packs load. If the pull fetched a
different release from the one the watch saw, the watch retries.

The signed retirement test reproduced `The release has no _template`.
It now preloads the remaining and new cells, holds grace while the new
pack is absent, and starts grace once after that pack becomes available.
