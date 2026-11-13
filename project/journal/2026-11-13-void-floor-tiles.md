# The void floor is tiles, not one slab (SA34)

> Written by: Claude (opus-sa34b), 2026-11-13

SA34's void walk stopped a metre past the outer road: Pine Hollow → ring 2's [0, 2] → north into the empty [0, 3] ended at
z ≈ 1441 with the player at y −0.17, unable to go on or back. The page did have the floor (a ray found it, top at y 0), and
so did the in-page server's road. The page predicts its own player and puts the server's state back on any difference, so
the server decides, and the server stuck too: placed straight onto the floor at z 1500 it walked 1.2 m and sank.

The cause was the floor's shape. Each band was one road-level cuboid, 2875 m × 1 m × 560 m. Rapier's capsule-against-cuboid
contact error grows with the cuboid's size, and at that size the character controller let the capsule sink 0.17 m into
the top and then found every direction blocked. A 2000 m cube drifted too (−0.013 m); 10 to 250 m boxes and trimesh tiles
stood the capsule at the usual 0.02 m skin.

The floor is now a flat trimesh per box, squares of at most 125 m (`VOID_FLOOR_TILE`), each collider in its own box's frame
with `FIX_INTERNAL_EDGES`, the way the strips are built. One collider per box, so the count doesn't change. The rim (a wall
nobody stands on) stays a cuboid. `test/grid-void-walk.test.ts` walks the in-page server's road from the outer road into
[0, 3], on to the rail and back: red on the slab, green on the tiles.
