# 2026-11-18: a client plan's vehicle keeps its hull (SS-GP5)

Meta SHARD-SOURCE SS-GP5. On staging v0.1.44 a walker crossed Mirror
Salt's parked land-sail in both hull walks, though Mirror Salt 0.0.3
carries the sail's inactive hull row and the engine builds hulls on a
data page and a grid data cell. A page probe found no kinematic body
at the sail.

Mirror Salt is a scene shard: its movers enter through the client
plan's `world.movers` owners (`clientMoverOwners.ts`), which installed
the followed movers without `vehicleHulls`, so a steer vehicle there
had no body on the page. It now passes the hull as the other two
paths do. `client-mover-hulls.test.ts` failed first.
