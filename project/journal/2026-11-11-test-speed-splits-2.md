# TEST-SPEED TS5, batch 2: six more files under 30 s

> Written by: Claude (opus-testspeed-lane)

The second batch of J255's 30 s line (the first is in
`2026-11-11-test-speed-splits.md`). These six files' cases are already
independent: each boots its own room, resident, database or child
process. Each is split by case. The module helpers move verbatim into a
fixture under `test/fixtures/`, and every test body moves unchanged.
Where a loop or `test.each` ran several slugs, the loop moves into a
fixture function, and each file passes the slugs it owns.

| File (hosted max, 14 runs) | Split | Cases | Local, alone |
|---|---|---|---|
| dedicated-doc (43.5 s) | refusal cases (ledger, outside-world, previous checkpoint, damaged slot, mismatched fact) -> `dedicated-doc-refusals` | 23 = 10 + 13 | 3.9 + 3.1 s |
| dedicated-save-safety (35.2 s) | the last five cases -> `dedicated-save-safety-admission` | 11 = 6 + 5 | 7.3 + 8.1 s |
| net-bots (32.8 s) | Driftwood's 32-player tick -> `net-bots-driftwood` (CPU-exclusive, its own unit) | 3 = 2 + 1 | 3.7 + 5.8 s |
| net-socket-room (31.2 s) | 256 KB close, keepalive, resume/ready, maxPayload -> `net-socket-room-limits` | 8 = 4 + 4 | see below |
| wind-elite-room (31.1 s) | the room fight -> `wind-elite-room-fight` | 2 = 1 + 1 | 5.8 + 2.5 s |
| headless-quest-verbs (30.7 s) | Nalati -> `headless-quest-verbs-nalati` | 3 = 2 + 1 | 5.2 + 4.1 s |

net-socket-room's local clocks moved with machine load (another lane
pushed it to 16): 4.3 s for the limits file; the 32-player half ran
9.5-12 s, which is the 32-player case itself.

What changes: dedicated-doc's room clock is per file, so the refusal
cases' rooms now boot at clock 0 instead of wherever the earlier cases
left it. Each of those cases boots a fresh room and reads only its own
ticks; none compares an absolute time.

Registries: the new net-bots file is a CPU-exclusive native unit, Ring 2
lists the four new files whose parents it lists, and the quest-verbs
products split with the file.

The six new files carry their first local clocks from the push gate's timing
reporter (two of them also run in Ring 1); the parents keep their old,
larger weights until hosted runs re-time them.

After the review dropped two unused imports, the refusals file was re-clocked
for its new blob by the push gate.

The nine parents (both batches) are re-clocked with the push gate's own
recorder for their new blobs: their old weights (up to 48 s) described the
unsplit files and pushed the full plan past 240 s a shard (ci 42972399841
failed at planning). Now 229.8 s at 15 shards.
