# Restore measured shard headroom

> Written by: Codex
> **State:** built locally, 2026-11-15. Hosted proof pending.

J295 queue-jumper: main a78994da, run 43792777770, shard 3 charged
314066 ms against 300000 ms. Its seven native files took 118.114 s,
ordinary phase 104.526 s, shared setup 70.638 s. Older Titan, socket,
cook and carry tests dominate; none of the 16 new files was on shard 3,
and every new file measured below 3 s.

The 15-shard ceiling prevents the planner meeting its existing reserve.
Replaying all 1555 measured file clocks floors at 255.708 s with 15.
Searching up to 24 instead selects 18 at 224.758 s. The six packed jobs,
native atomic groups, conservative unknown weights, 1.35 factor, setup
charge and 230/240/300 s targets stay unchanged. More shards pay more
process startup; hosted charged walls, including artifact upload, decide
whether this resolves the incident. No estimate is a hosted proof.

The historical replay includes one existing skipped browser case's file
collection clock. It does not claim 1555 passed files. Replaying only the
1554 passed-file weights, retaining that file as an unknown in the full
inventory, still selects 18 shards below 230 s. Keeping all 16 originally
unknown files conservative selects 22, also below 230 s.

The regression retains the real inventory and measured clocks, checks
that every old count exceeds the reserve, and requires the selected plan
to fit it without losing or duplicating a file.
