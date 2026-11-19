# 2026-11-19: the hard-cap test stops pinning a baseline's bytes

Lane: buddy-engine (keeper, J443; MAIN RED ffe31ce9ca..452e939bf3, run 44563105968, tests (3)).

`budget-files.test.ts` "Jake's hard caps are seeded" checks four caps, and then pinned Driftwood's
recorded download baseline at exactly 22,218,404 bytes. 452e939bf (netlag13, Nalati rev 4
baselines) re-recorded the file with `cli.mjs record`, Driftwood came out 22,227,966, and the
cap test went red although no cap moved (`budgets/caps.json` untouched). Baselines move with
content (J439, J444); caps move only on Jake's word. The line now checks the baseline is
recorded for a Driftwood revision and sits under the cap it reads from `caps.json`. The four cap
checks are unchanged.
