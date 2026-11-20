# 2026-11-19: vehicles drawn on a grid cell (MSZ14c)

> Written by: Claude (opus-mirrorsalt-m7, meta MIRROR-SALT-ZONE MSZ14c)

MSZ14b found that only the one-shard data page gave its followed vehicles a look. A grid cell followed them (their colliders,
prompts and seats) with nothing drawn, so on the grid, where staging serves Mirror Salt, a vehicle would have been invisible.

A cell's physics (`liveSession`, `installDataCellMovers`) and its drawn panels (`session`, `NeighbourPanels.admit`) arrive
apart and in either order, so the look is lent late: `FollowedVehicles.dress` takes a look and fx at any time and gives a
vehicle already out its panel copy where its row stands, and `dressCellVehicles` meets the two by cell instance. `panelLook`
now makes one copy an id however often it is asked, and a follower hides its looks as it goes, so a cell whose physics leaves
and comes back shows the same copy, not a second one frozen where the first was.

The scene path (`clientMoverOwners.ts`) is left without a look: it serves shards with a client plan, which draw their own
scene objects, and no such shard has vehicles.
