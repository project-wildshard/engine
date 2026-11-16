# 2026-11-16 Nine benchmax NB4: modules (mini-nb3)

- The boot yielded a timer task after each of the grid's 45 script memory reserves. Chromium makes all 45 in 0.6 ms; the
  turns were the whole 0.35 s of `app:script-memory-reservation` at CPU x4 (NB1, staging v0.1.31). Reserves now share an
  8 ms slice; a reserve that costs JSC a full GC still spends its slice and ends its own task. The phone's share of yield
  vs allocation is in Copy diagnostics' `boot.script-memory-bank` measure (memoryTurns, memoryWaitMs).
