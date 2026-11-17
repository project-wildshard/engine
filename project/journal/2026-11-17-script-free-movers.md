# Script-free movers (SHARD-SOURCE SS-GF2a2, opus-ss10c)

- Glowfen's raft (a scene shard, no sim scripts) drew on the dev page and took a rider, but never moved:
  `__workerClient().posed` stayed 0. `bindShardfileSim` built the script lane, and with it the declared
  movers, only when `shard.sim.scripts` was non-empty. Now a shard with movers gets the lane too.
- `test/script-free-movers.test.ts`: an `always` raft reaches its end; a `stand` raft waits, then rides
  once the player is put on its deck.
