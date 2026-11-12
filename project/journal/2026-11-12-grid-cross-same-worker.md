# Grid crossing on one worker (GC15, opus-gc15a)

- `DedicatedRoom.handOver` moves a seat to another cell on the same worker: body made in the target first (from the door's read of the
  player's save on that shard), then the source writes its save, lets the body go and `NetRoom.handOff` moves the same socket. The door
  orders it on a room's `crossing` news and only when both cells share a worker; cross-worker is GC15 (3).
- Surprise: `workerTable(cells, 1)` still opens two workers when two dedicated cells are named. Staging's 2 workers put Nalati alone on
  worker 0, so Driftwood → Nalati is cross-worker; Driftwood → Far Reach, Pine Hollow and Sunscar are same-worker.
- Not wired yet: nothing posts `crossing`. The worker needs the road (its strips, `addCellWalls`) and a per-seat crossing driver first.
- Review (one-shot `claude -p`): 2 MUSTs folded. A hello mid-crossing now closes `retry` (the door can't ask either cell), and the
  door keeps the seat counted through the source's `left` until `crossed` says moved, stayed, or gone. `NetRoom.live` is checked
  before anything moves, so a not-yet-welcomed link stays where it is. SHOULDs folded: `recovered` on a previous-doc arrival, the
  voice body renamed. Voice still routes by the seating cell (next lane).
