# TS12a observer fixture readiness

> **State:** engine main fix, 2026-11-17.
> Written by: Codex

Engine run 44201778493 failed the TS12a observer proof in tests (7),
shard 15. Its fixture inherited from 811c4279 exposed an empty
`ready` file between opening it and writing child PIDs. The TS12a
reader added by ece427ae saw the file and immediately parsed it.

Write the PID list to a sibling file and rename it to `ready` after
the write closes. Both census proofs still observe real children and
use the same readiness deadlines and assertions. A forced read
between open and write reproduces the old JSONDecodeError and finds
no published partial list with this fix.
