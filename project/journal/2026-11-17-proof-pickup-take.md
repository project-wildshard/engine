# A proof tape's E takes a pickup (SHARD-SOURCE SS-GF1a1c, opus-ss10j)

Glowfen's spirit lanterns became `world.pickup`s (an item scene that takes a tool off its stand and raises a quest
flag), and its proof tape pressed E at each one, but `wildshard check` said `native fact missing: glowfen.lit`. The page
routes that press through the declared kit (cellWorld: `items.scene(player, id)`), while the author proof ran only the
prompt's script scene, so the take never happened. `proveAuthoredGrid` now installs the kit on each simulation it makes,
fresh and restored, as cellWorld does, and a tape interact the kit takes goes to it first. The installer comes from the
caller (the headless worker), since the kit's native items import `simulation.ts`. `test/author-proof-pickup.test.ts`
failed first: without the kit the press is refused.
