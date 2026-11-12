# ENG-19: author-bundle cache keys on linked sources

> Written by: Claude (opus-eng19)

J196's link workspace points a shard's `node_modules/@wildshard/sharddev` (and engine, format) at the
source checkouts. Product receipts skip `node_modules` and anything outside the shard root, so an edit in
linked sharddev reused the stale author bundle until someone set a `VITE_*` variable. The cache namespace
now hashes every linked checkout it finds behind `node_modules` (recursively): HEAD plus the bytes of
changed and untracked files for a git checkout, path/size/mtime for a plain directory. About 200 ms per
CLI run on a linked Dunes. Pinned installs resolve into a pnpm store and keep keying by their pins.
