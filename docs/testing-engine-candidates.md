# Shard engine test candidates

The November 7 test-debt pass left 283 files in seven shard pending
lists because they imported engine implementations. The follow-up
review migrated 43 files here and removed 240 coupled internal tests
under J186. `test/engine-lift-disposition.json` records every source
file, its original test titles and its decision.

The migrated tests drive real native hosts, physics, storage, codecs
and network clients. They cover multiplayer weapons, grapples,
canoes, weather, wildlife, boss rewards, death checkpoints, portal
rides, readings, inventory and save restoration. Mixed files retain
their outer-edge scenarios and drop private compiler, identity,
callback-order and predecessor-byte parity assertions.

Forty files run in Ring 1. The shared product fixture selects the
actual server slice when `WILDSHARD_RING=1`; its eager asset reads
match the standalone worker. Published return/spawn programs replace
imports from shard generators. Small JSON fixtures supply scenario
inputs; they are not output goldens or a second shard compiler.

Three files run in Ring 2: hostile network/seam tests also use Pastel
Plain; ABI2 browser transport needs the complete Driftwood product;
the read-only budget report needs the sealed Night Market product.
Their names are in `test/pins/ring-2-tests.json`. Product dependencies
are recorded in `scripts/test-products.json`.

Tests use short bounded scenarios. The default network fuzz tape is
120 ticks per product and seed; `NET_FUZZ_TICKS` and
`NET_FUZZ_SEEDS` remain explicit manual soak controls. No hook or test
exclusion was added. The pre-existing engine pending list belongs to
the separate engine port and is unchanged by this work.
