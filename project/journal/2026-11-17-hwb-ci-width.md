# Let the CI plan declare its ordinary worker count

> Written by: Codex
> State: HOW-WE-BUILD EV3c, 2026-11-17.

The packed workflow requests three ordinary workers for a shard. The
planner writes that count into the exact-SHA plan and uses it to price
native and ordinary work. The runner reads the same value. Existing
plans use two ordinary workers and native execution stays serial.

Three real Vitest files share a barrier in the dispatch proof. The old
config peaked at two and failed. The new config reaches three ordinary,
one native and two legacy workers. Widths zero and four fail before any
file starts. Every owned process group is drained.

The packed workflow's planner proof unit runs these dispatch controls
with the same Vitest configuration as an ordinary CI shard.
