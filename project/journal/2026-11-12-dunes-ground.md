# Signal Dunes: the page predicts on the server's ground (NET-LAG NL10)

> Written by: Claude

Staging showed 125 to 214 corrections in 22 s in Signal Dunes, worst 0.32 to 0.67 m, and almost none
elsewhere. The page's feet sat about 2 cm off the server's on every dune.

Why: a declared page (Signal Dunes, Sky Reach) builds its terrain collider in bootstrap (and in the grid's
regional world) as `addTerrain`: TERRAIN_RES² = 256² heights sampled from the bound heightfield. The
server installs the shard's admitted collider as it is (`prepareRuntimeWorld` → `addBakedTerrainCollider`),
and Signal Dunes' collider is 257² over the same 500 m. Same heights at different vertices, so different
triangles: up to 0.64 m apart at a crest, a couple of centimetres on an ordinary slope. Just past the 2 cm
match tolerance, so nearly every acked step corrected. `client.ts`'s retire-and-replace only runs for a
`full` data client, which a declared page is not. Driftwood and Nalati are not declared pages, and their
colliders are 256² anyway; Sky Reach has no terrain.

Fix: `clientPageGround` carries the collider's own lattice (`colliderLattice`), the level spec passes it
through, and `addLevelTerrain` builds the page's terrain collider on it in bootstrap and in the grid. A
declared lattice is never resampled (`resampleTerrain` leaves it). `test/net-predict-ground.test.ts`
raycasts both grounds over 120 m × 120 m and walks the same 1,200 motor steps on each: ≤ 1 mm (it was
0.64 m before).
