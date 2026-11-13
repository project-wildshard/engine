# serve-build --head refused Driftwood: the slot had no git

`serve-build.sh --head` refused `driftwood-isle` with "KTX2 table
names a missing file: /assets/gpu/models/driftwood-blender/
lm-ao.phone-9f6766dc.ktx2", after `pnpm pins` and with that file
present in the slot. A working-tree build and a clean clone passed.

The cause: `pins.ts` admits a KTX2 target that is a tracked engine
file by asking `git ls-files public`. A build-mirror slot is a work
tree with its own index and no `.git`, and build-mirror sets
`GIT_CEILING_DIRECTORIES` at the slot on purpose, so git finds no
repository there. The call printed "fatal: not a git repository" at
the top of the build log, the catch returned an empty set, and every
tracked engine KTX2 a product names looked missing. Driftwood's table
names five of them, so it was refused. It was never stale pins.

`scripts/tracked-public.mjs` reads the list from the index the
mirror names: `build-mirror.mjs run` passes `WS_MIRROR_REPO` and
`WS_MIRROR_INDEX` (the slot's index, at exactly the synced commit) to
the build, and `openMirror` returns `index`. In a checkout, nothing
changes. `test/tracked-public.test.ts`, red first.

## Follow-up: the pins reuse key

Main went red on `test/tooling/pins-reuse.test.mjs`: every local
module `pins.ts` imports must be in `KEY_SOURCES` (its bytes decide
what a full install writes) or `KEY_EXEMPT`. `tracked-public.mjs`
decides which KTX2 targets admit a product, so it is a key source; a
change to it now invalidates reused pins. I had run the build-mirror
and tracked-public tests, not this one.
