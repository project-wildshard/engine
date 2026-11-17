# Preserve measured shard headroom

> Written by: Codex
> **State:** repaired locally, 2026-11-17 13:51 Cancún.

Main aaab8f8a39 passed run 44148096662, with a shard-7 wall AMBER:
304,412 ms against 300,000 ms. Packed job 3 charged 96,644 ms of shared
setup and 206,261 ms of test work. Both native files and all 77 ordinary
files passed; no individual file exceeded its budget.

Replay the actual 1,877 measured module clocks and three unmeasured
members. The old 24-shard search stops at a 234.580-second prediction,
missing the planner's existing preferred 230-second reserve. Searching
up to 32 logical shards selects 25 at 227.996 seconds. The same nine
packed hosted jobs execute them; Ring 1 still searches up to twelve.

Keep the existing calibration, budget gates, native isolation and
complete discovered inventory. No cook, scene, test case or assertion
was reduced. A regression using the actual clock table fails before
the cap change, then all six timing cases pass. Hosted wall evidence
is required to establish the resulting runtime improvement.
