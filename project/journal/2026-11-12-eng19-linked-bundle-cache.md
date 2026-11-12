# ENG-19: author-bundle cache keys on linked sources

> Written by: Claude (opus-eng19)

J196's link workspace points a shard's `node_modules/@wildshard/sharddev` (and engine, format) at the
source checkouts. Product receipts skip `node_modules` and anything outside the shard root, so an edit in
linked sharddev reused the stale author bundle until someone set a `VITE_*` variable. The cache namespace
now hashes every linked checkout it finds behind `node_modules` (recursively): HEAD plus the bytes of
changed and untracked files for a git checkout, path/size/mtime for a plain directory. About 200 ms per
CLI run on a linked Dunes. Pinned installs resolve into a pnpm store and keep keying by their pins.

Review fold (one-shot Opus, no MUSTs): git runs without inherited `GIT_*`, untracked files key by size and
mtime (no full reads of big untracked assets), individually ignored source files (generated `.ts`) key too,
a checkout nested in an already-keyed one is skipped, and a linked edit during compilation publishes no
bundle. Limits: a collapsed ignored directory (`dist/`) is not keyed, and each linked edit makes a new
namespace under `.author-bundles`, which nothing prunes yet.
