# Dunes r5 budgets recorded

buddy-engine, 2026-11-20, ONE-FORMAT OF19d step 2.

Dunes rev 5 (the ordinary upload: no actors, no species programs) was pinned in `04855fb7de`, and every budgets run since
has shown its six keys as `raised` against the r2 baselines (`sunscar-dunes@2 → @5: record it`). The first green main
run carrying the pin (`37d6d0428e`) had a budgets run that failed on a Nine triangle regression, not on Dunes, so the
six readings come from the latest successful budgets run, 44766175458 (measures from `e02289a2da`).

Only the `sunscar-dunes` keys are recorded: `record --run` writes every key in the artifact, which would have stamped
other shards' current readings as their baselines without their owners. The six were filtered out of the artifact and
recorded with `cli.mjs record <measures.json>`.

r2 to r5: download 11.43 to 11.46 MB, phone-low triangles 285,835 to 276,837, draws 54, programs 48 to 50, ledger
control 150.5 to 142.4 MB, peak 191.1 to 196.8 MB (all far under their hard caps).

The staging walk of r5 on v0.1.57 (`1b69ff06`) passed 13/13 the same day: two players, the Matriarch down inside her
arena in 205 blows, and the page's `sunscar-dunes/shard.json` carries no actors or species programs.
