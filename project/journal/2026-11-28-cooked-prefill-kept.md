# 2026-11-28 The cooked store keeps a prefill and sweeps itself when full (PV29)

PV26 prefilled `wildshard-cooked` at cook 1.21.0, a release ahead of any channel. Nalati failed on the 4 GB pack budget:
1.06 GB of retired cook versions (1.17.0, 1.18.0, 1.7.0, 1.0.0) were still held, and were deleted by hand. The nightly
prune keeps only the indexes a channel names and those under a day old, so it would also have taken the prefill at 24 h.

Now the prune keeps a cook version newer than every named one for 7 days, and a versioned recook sweeps the store first
when it holds over 85% of the budget, even if the nightly sweep ran that day. None of this is in the cook hash. The
in-publish reclaim lives in `cookWorker.ts`, which is, so it waits for the next cook bump.
