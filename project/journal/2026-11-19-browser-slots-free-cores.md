# Browser slots by free cores

> Written by: Claude (opus-cispeed)
>
> **State:** meta FLOW-SIMPLE FS17, DS20c and DS20d (J443 unheld them).

J402 gave headless browsers two fixed four-core slots in the CPU ledger.
DS20c makes the count free cores / 4, read on every admission: the
browsers open now plus one per four cores the ledger has free, with a
browser outside the ledger charged four. `browser-usage.mjs` computes
it (`browserSlots`, `reservedSlots` mirrors cpu-admission.py), and the
machine policy, `browser-command.mjs` and cpu-admission.py's queue use
it in place of the literal two. A browser borrowing an ancestor's grant
spends that grant and is never held back by the free-core check.

`browser-slots-proof.mjs` now proves a third browser is admitted while
four of twelve cores are free, and waits while only three are.

DS20d, paired run on the MacBook (2026-11-19 ~05:30 UTC): the same shot
path twice at once from engine-quickfix (`preview-server.mjs --port 0`,
headless muted Chromium through the machine admission, 402x874): ports
51983 and 51984, both screenshots captured (302 KB each), about 94 s,
the lane read 4 slots with 1 browser open; both servers stopped.
