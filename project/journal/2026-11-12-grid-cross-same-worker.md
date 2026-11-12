# Grid crossing on one worker (GC15, opus-gc15a)

- `DedicatedRoom.handOver` moves a seat to another cell on the same worker: body made in the target first (from the door's read of the
  player's save on that shard), then the source writes its save, lets the body go and `NetRoom.handOff` moves the same socket. The door
  orders it on a room's `crossing` news and only when both cells share a worker; cross-worker is GC15 (3).
- Surprise: `workerTable(cells, 1)` still opens two workers when two dedicated cells are named. Staging's 2 workers put Nalati alone on
  worker 0, so Driftwood → Nalati is cross-worker; Driftwood → Far Reach, Pine Hollow and Sunscar are same-worker.
- Not wired yet: nothing posts `crossing`. The worker needs the road (its strips, `addCellWalls`) and a per-seat crossing driver first.
