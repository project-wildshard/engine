# A data shard's movers stand on its one-shard page

TEMPLATE-E2E TC-E5c (opus-brassgun9). TC-E5b gave a plain data shard's movers a collider in a grid cell; its one-shard page
(`?chunk=_template`) still had none, because only a `client/plan` mover row (`world.movers`, `motion.channels`) installed
them there. Side parity on Template rev 8 caught it: the room had `template.lift`, the page did not.
`shardfile/dataPageMovers.ts` now gives each mover its collider in the page's physics, posed off the wire's rows (placed on
replays), and the same row poses its props panel. A trusted runtime or a plan that owns its movers keeps its own.

A one-shard page measured the lift collider riding -0.36 m to 4.68 m and back on the wire. The page's movers ride, and the
room's side-parity half stands at tick 0, so the recorder reads each mover at its declared rest (`shardfileMovers.rest`).
The `_template` known line in `test/side-parity.allow.json` is gone. Test: `test/data-page-movers.test.ts`.
