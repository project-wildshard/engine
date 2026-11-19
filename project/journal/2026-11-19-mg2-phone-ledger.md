# Shard CI uses the live EM11 memory fit

> Written by: Codex
>
> **State:** measured 2026-11-19. MEMORY-GATES MG2.

The published engine v0.1.50 probe reported Nine at 1,604 MB from 769 MB of Chromium renderer
memory during application modules. Two repeats gave 1,708 and 1,321 MB. The local dev-world server
ran in a separate process and the client stayed online without an in-page server worker. The
Chromium renderer includes the game's own JS, storage and browser overhead. Its sample and
the separate Chromium GPU process are different inputs from MG10's minimal native WebKit
WebContent and GPU checkpoints.

The probe had also been matching a trace id to the next sample. Matching by order moves the first
two Nine peaks forward by a sample in the same modules step. The corrected historical projection is
1,318–1,708 MB. MG10's exact Nine r3 upper was 1,391 MB on engine `f140af73`. MG11 read the same
archive at 1,281 MB upper on `8951cab0`. The old renderer factor came from older builds and lets a
Chromium renderer excursion dominate the verdict across browser backends. Nine's MG10 and MG11
online WebKit uppers both clear the 1,500 MB line.

The default probe feeds the loader's GPU, RAM and worker counters through the same
`phoneFromLedger` fit as the Developer panel. It judges the largest central value through control
and reports the fit's range. The peak-over-settled multiplier is for forecasting a boot from a
settled reading, so an observed boot doesn't apply it. Chromium's raw process and heap peaks
remain in the report. A client without a loading ledger produces a measurement error. The
explicit `--factor` option remains available for historical replay.

## Exact pinned archive comparison

Both Chromium columns use the same worker-free online CLI candidate boot on the v0.1.50
preparation client at `fedf7593`. The legacy column applies 2.086 to the order-corrected loading
renderer peak from that capture. Each row is one Chromium boot. MG11 is the independent
three-boot native WebKit result on `8951cab0`. All figures are decimal MB.

| Zone and archive | Chromium renderer | Legacy same-boot estimate | Ledger central / high | MG11 central / upper |
|---|---:|---:|---:|---:|
| Brasscap r9 `56414c67` | 372 | 775 | 699 / 1,034 | 619 / 750 |
| Driftwood r5 `329f37d6` | 525 | 1,096 | 899 / 1,316 | 895 / 1,056 |
| Nine r3 `afd68ee2` | 627 | 1,308 | 1,029 / 1,497 | 1,088 / 1,281 |
| Pine r6 `86c0ecc5` | 779 | 1,626 | 1,318 / 1,868 | 1,205 / 1,339 |

The published CLI's separate cold boots read 847 MB on Brasscap, 1,249 MB on Driftwood and
1,415 MB on Nine. Its first Pine run kept only one matched dump, at page start, so its
257 MB estimate has no loading coverage. That read is excluded.

With the release client and archive held fixed, three more cold native minimal WebKit boots
of Nine gave central/high pairs of 1,180/1,306 MB, 1,177/1,304 MB and 1,201/1,324 MB. The
combined central / one-sided 90% upper was **1,180 / 1,335 MB**, under the line on the same
client as the CLI. This agrees with MG10 and MG11's verdict. The ledger fit's high end is
its error envelope, while the native upper comes from repeated WebKit boots. The CLI
compares its central estimate, as before. Native guard policy and the 1,500 MB line stay
in place.

Raw captures and exact pin hashes are in
`~/.cache/wildshard/plan-artifacts/mg2-probe-parity-2026-11-19/`. The hosted Linux Nine
boot timeout in run `44580026170` occurs before a memory verdict. Its diagnosis is part
of MG2's shard CI wiring.
