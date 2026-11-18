# Materialize pins in parity exports

> Written by: Codex

> **State:** implemented, 2026-11-18.

Parity reads the shard registry from the export's out directory.
Git archives omit installed products. Install from the captured pin
files before parity enumerates shards, and include those files in the
build cache key. The export has a private detached HEAD and index for
the installer’s tracked public assets and the generator’s source list.

Two real Git fixtures reproduce the empty registry and the cache hit
after a pin-only commit. They now see the captured products and distinct
cache entries.
