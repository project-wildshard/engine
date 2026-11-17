# MMO-PLAN MP1.6b: a crossing to another worker carries the stepped seq (opus-mmo2)

- A road on one worker lets a client go (`NetRoom.handOut`), and a cell on another worker seated it on a fresh `CommandQueue`, whose
  `lastSeq` 0 the arriving owner block said until the client's next command was stepped. Past 0x8000 that 0 reads as ahead of every
  command the predictor holds, so it stopped reconciling until `seq` wrapped (the client's ack fix, MP1.6a, only stopped the sends).
- `handOut` now returns the client's last stepped `seq`; the road's port says it with `out`, the door passes it on the `arrive` order as
  `commandSeq`, and the cell seats the client with `NetRoom.arrive`, a queue that starts there (`CommandQueue.after`). An `out` with
  no seq seats a fresh queue, as before: seeding 0 would drop every command of a client past 0x8000 as spent.
- Red first: `net-player-crossing.test.ts` (a predicted client past 0x8000 crosses; its owner block never says 0 and a server slip is
  corrected) and the crossing churn's `zeroAcks` (no owner block says 0 after the walker's commands were stepped).
