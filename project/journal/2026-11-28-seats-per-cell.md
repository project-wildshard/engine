# 2026-11-28: the seat cap is per cell (J409)

- Meta QA 11-26 row 74 (www WW17). The door counted every seated and loading player in the grid against one `seats` number, so
  production's `WORLD_SEATS=32` let 32 players fill the whole world. J182 said the cap is per grid; J409 (11-17, newer) keeps
  32 seats per cell.
- Change: the door finds the cell first (where Shard select sent them, else where they last stood), then counts that cell's
  seated and loading players and queues in that cell's own line. A full cell queues; another cell still admits. A loading
  seat now carries its cell. `WORLD_SEATS` means seats per cell (workerTable, setup.sh's env comment).
- The saved place is read before the line now, so a queued retry costs one `where` read; the Name claim stays after admission.
- A mover from a held seat is still admitted (FM7b2): its old seat counts in its old cell until that cell's `left`.
- Guard: test/dedicated-world.test.ts fills Driftwood at 2 while Nalati holds 1, then a Driftwood-bound player is queued at
  position 1 in Driftwood's line and a Nalati-bound one walks in. Under the old grid cap the second Driftwood player is refused.
- A whole-box ceiling, if one is still wanted, is a bench number (J182), not this change.
