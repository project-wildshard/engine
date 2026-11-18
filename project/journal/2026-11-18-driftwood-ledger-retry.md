# Retain a refused ledger boot's timeline

> Written by: Codex
> **State:** fix forward, 2026-11-18.

Ubuntu ledger run 44300884519 reached control on Template and Brasscap.
Driftwood stopped at Props after 61 seconds without progress. The
direct ledger artifact had no control sample. Its Brotli cache missed.
Run 44276449981 had already reproduced the same failure before the
cache, and a targeted hosted run later reached control three times.

Buddy-engine's 6a925a36 retains both numbered attempts and requires
a fresh successful boot for comparison after a refusal. The direct
probe now includes a bounded snapshot of the boot timeline when the
browser refuses the load. A controlled Chromium failure card retained
its open wait in the report. This gives the loading owner the missing
operation if the stall comes back.
