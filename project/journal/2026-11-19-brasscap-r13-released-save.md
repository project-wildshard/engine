# Replay the released Brasscap save against rev 13

In hosted run 44637566964, tests (4) passed the build CPU controls. The
control log shows the deliberate failed launch, mirror-order rejection and
invalid inherited grant. The failing assertion was the released-save replay.
Brasscap's rev 13 pin (`148d68f07`) moved to `c0a5acd3` while the replay still
named rev 12 (`4c4d1cb0`).

Use rev 13 as the target of the same v0.1.1 save replay. The original
save, refusal on a changed level and carry-forward of its progress flags
are the same assertions exercised by the test.
