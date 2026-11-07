# Published calibration: real boot budget reports

Captured on private candidate 520693016a02dd13447c4fc1a9bbf7bf82d7aa67 (base 59692bf2, calibration parent f53f9ecd), Chromium 153 on M5 Max/ANGLE Metal. All seven phone boots have errors `[]`; template and both new shards were also measured on desktop to seed GL-byte ceilings. Original four shards use the existing parity fingerprint/poses capture (including Nine Dragon's free camera); unpinned shards use their actual spawn camera after 90 harness frames and one composer redraw. Phone viewport is 390 × 844, DPR 3, phone tier. The preview was held by a retained exec lease and all owned browsers/previews were closed.

Final assessment uses the generated manifest data and the same budgetChecks function as parity. These are structural counts and tracked GL allocations, not measured iPhone frame times. Phone costs remain the documented M5 × 10 assumption.

| Shard | Draws observed / target | Tris observed / target | Programs observed / target | GL MiB observed / ceiling | Verdict |
|---|---|---|---|---|---|
| _template | 46 / 1831 | 11833 / 18779873 | 40 / 148 | 76.731449 / 76.731449 | pass |
| driftwood-isle | 223 / 1174 | 1125728 / 18779873 | 95 / 148 | 219.436898 / 219.436898 | pass |
| far-reach | 63 / 1831 | 11972 / 18779873 | 35 / 148 | 76.629364 / 76.629364 | pass |
| nalati-grasslands | 108 / 1174 | 1292909 / 18779873 | 98 / 148 | 225.796532 / 225.796532 | pass |
| nine-dragon-stack | 144 / 1174 | 1427662 / 18779873 | 66 / 148 | 271.438090 / 271.438090 | pass |
| pine-hollow | 147 / 1174 | 1324374 / 18779873 | 109 / 148 | 587.132421 / 587.132421 | pass |
| sunscar-dunes | 43 / 1867 | 79720 / 18779873 | 30 / 148 | 57.324120 / 57.324120 | pass |

FINDING (accepted by wildshard-9): Pine phone 587.132421 MiB versus previous 581.166576 MiB (+5.965845 MiB). R9 eb3d9a7875b47cae0349ee234e47efdc75efb30c uploads all three people before play, per Jake's rule. Re-recorded only these three pose GL-byte ceilings from the capture.

FINDING (accepted by wildshard-9): template phone 76.731449 MiB versus 76.730614 MiB; desktop 171.080982 versus 171.080147 MiB (+876 bytes each). G6 26b5f6b35eb7b2af4e36e617fa0321526ad6a46c first draws the mounted lantern. Re-recorded only the current GL-byte ceilings. Exact approval, causal commits, capture hashes and extracted values are in ../ceiling-sources.json reRecords and ../ceiling-re-records.json; no numbers were entered in the approval.

Reproduce derivation (byte-idempotent):

`node scripts/budget-ceilings.mjs --lanes=m5 --reports=budgets/calibration-reports --accept=budgets/ceiling-re-records.json`

assessment.json contains every per-pose check and any derived-target breach. Capture reports retain their original pre-acceptance ceilings to preserve the findings. No calibration cost, allocation, frame target or non-approved ceiling was raised.
