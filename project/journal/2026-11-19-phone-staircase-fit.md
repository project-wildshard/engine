# iPhone 17 Pro staircase fit

> Written by: Codex

> **State:** EM37 item 1 measured 2026-11-19 on staging. No change to the process limit or the budget lines.

Jake's Safari tour (meta `a0cc751f`, `project/evidence/engine-memory/17pro-staircase-2026-11-19/`) reached a nominal
1,088 MB for JS objects and 872 MB for 2D canvases. Those are the last completed allocations. The page counts
48 bytes per JS object and uses decimal MB. It does not see native process footprints. At the existing 2,048 MiB
WebContent ActiveHard reference, the effective factors are 1.974 and 2.463. They include the page floor, allocation
step size and browser overhead. This tour cannot separate JSC overhead from GC slack, or canvas backing stores from
their copies.

Reproduce the kind fit with
`node scripts/memory/phone-fit.mjs --staircase=<evidence.json>`, passing the `staircase` subobject of
`scripts/memory/phone-model.json` as evidence. Keep the four Nine anchor windows' process fit (alpha 0.309–0.744, scale 0.648–0.911), the
2,048 MiB crash line and the chip's 1.50/1.75 GB warnings. EM11 used a pooled 3.328 coefficient for all tracked RAM.
Nominal JS heap and canvas bytes now use the phone factors once in the ledger-to-phone path, including loading
samples and the subsystem panel. The native WebKit path already reads real footprint. The other nine ratios stay
as evidence since GPU, workers and typed buffers have their own existing accounting. The parsed cache-document
charges already estimate objects, strings and maps (up to 4× wire bytes plus per-entry costs), so they stay pooled.
Typed-array collider data also stays pooled. Unlabelled JS objects, including temporary validation and collider
wrapper objects, are still covered indirectly by the process fit. The ledger has no fleet census of those objects.

Replayed 966 ledger readings from all 99 online MG11 boots (meta `9364849d`). The highest tracked 2D canvas charge
was Nalati at shaders, 3.30 MB nominal or 8.13 MB by the new factor. The maximum central prediction change was
2.86 MB and no reading crossed either J410 line. The archive has no nominal JS-heap counter. Pine's 532 MB Chromium
heap reading is the largest of the four MG2 probe snapshots, and includes non-object memory. It is a different
instrument and cannot measure room to the Safari staircase reference.
