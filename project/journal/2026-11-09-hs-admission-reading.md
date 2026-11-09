# HS3 and HS5: preparation readings, no saving claimed

While the J201 Linux soak held its normal performance lease, separate
short CPU-admitted readings used the unchanged public Nalati product.
No quarantined test body or shared headless fixture was edited.

Three fresh `beginProductSession` calls, each followed by actual worker
readiness, one real step and disposal, measured parent preparation at
550.17/353.68/345.53 ms. Readiness was 2812.50/2112.21/2096.82 ms from
the same starts. Every returned checkpoint was 12,951,526 characters.
These are one-process preparation readings, not paired speedups or
whole-file quarantine timings.

Four separate ordinary `loadHeadlessProduct` calls took
160.13/134.98/133.97/131.90 ms. Reading the complete 331-file asset bank
(87,315,787 bytes) then took 12.95/12.23/9.85/8.90 ms. The load profile
attributes 140.92 ms over the four calls to the format JSON visit,
68.00 ms to a Valibot runner, 47.12 ms to receipt writing and 37.17 ms
to GC. These samples include import/startup cost; they do not establish
the delta any cache can safely remove.

The metadata path is the useful HS3 experiment. Keeping an extra mutable
87 MB bank solely to avoid roughly ten milliseconds of disk reads is
not justified by these numbers. A same-header cache must still refuse
replaced section/blob bytes, keep admission modes separate, and return
owned mutable byte views. It cannot turn an unchanged header or file
timestamp into permission to trust changed disk contents. Worker worlds,
physics bindings, RNG and their original admission remain fresh.
Pine retains the caller file pending a measured safe API handoff.

The unchanged explicit Nalati herd proof also passed under a two-slot
CPU grant: all 35 actors retained, all 180 measured frames near the herd,
p95 2.8875 ms, case wall 965.61 ms (runner 1886.46 ms). Its short profile
contains 9.54 ms in bank readFull, 9.17 ms in group-step prepare,
9.08 ms in return-frame snapshot and 5.67 ms in numeric observations.
This only identifies remaining HS5 work. No optimization, canonical-save
claim, hosted saving, quarantine promotion or completed HS row follows
from these unpaired preparation readings.
