# Touchable props on a data shard (meta SHARD-SOURCE SS9b), opus-ss16m

- `shardfile/touchBodies.ts`: each shard-format `props.bodies` row (format SS9a) is one Rapier dynamic body in the host's
  world, in the ITEM group, so a player's character motor pushes it and every player sees the same crate.
- Its pose rides the wire as the row's script body (`script:<id>`, YXZ euler as a mover's), the channel a mover's panel
  already rides, so SS9c can pose the named panel off it.
- The bodies live in the physics world, so a save carries them in the world's snapshot; this owner saves each row's
  handle and rebinds them after a restore replaces the world (a missing or changed body refuses).
- `bindShardfileSim` installs them for every data shard. Test: `test/touch-bodies.test.ts` (a walk pushes the crate over
  0.5 m, the wire pose matches, a restore matches and goes on identically, a duplicate id refuses).
- SS9c: `shardfile/touchViews.ts` gives each row a kinematic stand-in (WORLD group) in the one-shard page's physics or a
  grid cell's, posed off the wire's `script:<id>` row, and draws its named panel there (`moverPanelPose` with the row's
  rest); a cell takes the wire once the feet enter it and its drawn panel (`neighbourPanels.ts`) keeps the id after.
  Test: `test/touch-views.test.ts`.
