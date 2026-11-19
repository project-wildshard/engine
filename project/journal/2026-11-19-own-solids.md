# A native plan with no collision host stands its own prop solids (ONE-FORMAT OF22a3)

> Written by: Claude (opus-of22b)

Driftwood's `collision` host stands 2,000-odd baked solids from the
bake: cuboids, capsules for the palm trunks, convex hulls, each with a
material, Rapier groups and a friction. Format 0.52.0 lets a prop
collider say all of that, so the island can write them as
`props.colliders` rows and drop the host.

Two engine halves. A prop solid's capsule, friction and groups now
reach Rapier (`propColliderDescriptors`, `addPiece`); a solid that names
none keeps the world's groups and Rapier's 0.5 friction, set every time
so a reused box descriptor never carries the last solid's. And a native
plan with no `collision` or `collision.pieces` host stands its bake's
ground alone plus the shard's prop solids, before its hosts, with the
same `props.declared` continuation an ordinary upload's simulation
keeps. Every plan today has a collision host, so nothing else changes.

Proof: the shipped Driftwood product beside the same product with the
host cut and the bake converted to rows meets the same surface at the
same height on a 5 m grid, stands a player on the pier the same, and
saves and restores exactly.
