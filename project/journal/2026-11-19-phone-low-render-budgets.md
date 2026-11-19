# Phone Low frame workload budgets

> Written by: Codex
>
> **State:** implemented and measured, 2026-11-19.

MacBook QA row 20 reported heavy Driftwood rendering on the iPhone 17 Pro.
The budgets workflow had download, code and memory readings. Nine’s street
walk tracked triangles and draws separately. Driftwood and the other zones
had no frame workload readings in that workflow.

The budget job now checks every pinned product on its source build in
headless Chromium with SwiftShader. A fresh 402 × 874 phone context applies
Low, pins the live drawing scale at 1× and uses the engine’s fixed 30 Hz
capture clock. At three fixed headings from spawn it takes three distinct
complete frames. Each metric takes the heaviest heading’s median. Draws
and triangles come from the frame totals and programs from the live
renderer’s linked cache. The probe refuses an incomplete sweep, a stale
build, or a reading at the wrong tier, preset or density.

Engine `602f0d9344` supplied 78 baseline values across 26 shipped pins.
Driftwood r5 read 708,765 triangles, 73 draws and 91 programs in the
fixed views. Nalati’s renderer needed to apply Low at control, which
the probe now does when the live preset is still unset. The values are
renderer counts for this instrument and are compared by shard revision.

A seeded 10% rise on Driftwood r5 raised three regressions through
`scripts/budgets/cli.mjs check`. The same counts under r6 were treated
as new content, eligible for recording with the existing BC10 command.
