# The tile census charges library files once (QA 11-26 row 55)

Lane opus-qa-tools. Pine's images-only re-pack made its twelve terrain
layers JPEG image blobs. They were already library roots
(Pine groundTiles.ts), but every L0 ground GLB depends on them, because
the format requires a splat layer to be a props tile's dependency. SF20's
census moved each tile by the cooked KTX2 difference of every file in its
closure, library or not, so each L0 tile carried about 11 MB and Pine
recorded 80 rows of tile debt.

The client leases the library once and a tile reads only its own files,
and the format's own tile budget (budget.ts ownTileBytes) already charges
library files once, never per tile. The census now takes the index's
admission.library and leaves the library closure's files off each tile's
cooked move. Files outside the library still move. Pine drops its 80 rows
once its engine pin carries this. Its product bytes don't change, and
neither does its phone download.

Guard: test/tile-bake-cooked.test.ts "row 55".
