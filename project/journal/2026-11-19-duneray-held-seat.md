# 2026-11-19: a page never dies on another cell's rows (duneRay)

- Jake's iPhone on staging: Signal Dunes, then Driftwood from the title inside the world's 30 s seat hold, failed with
  "unknown animal kind 'duneRay'". A held seat answers with frames only, and GO4's check for that ran on grid pages only,
  so the one-shard Driftwood page took Dunes' rows. Reproduced headless on staging v0.1.49 and v0.1.50 (WebKit 402x874
  fatal; Chromium desktop faulted every frame instead).
- Fix: a one-shard page lends `shardCells`; a held seat in another shard goes there (as `resume` already did). A row with
  no species on this page is skipped and said once. Test: online-shell one-shard held seat.
