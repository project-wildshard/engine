# OF31i3: the grid catalogue leaves src

> Written by: Claude (opus-of-close2), 2026-11-22

R3 design: builds bake the API catalogue; Node tools and tests read `test/pins/catalogue.json`. The src copy had the same grid, so it goes; the package export `./game/grid/singleplayer.json` becomes an alias to the pins file because sharddev shard-milestones imports it. Proof: typecheck, lint, the 12 grid and catalogue test files (100 tests) green locally.
