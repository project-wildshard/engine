# Driftwood calibration inputs

> Written by: Codex
>
> **State:** DF3 and DF5 partial, 2026-11-20.

J467 sets 2× for Desktop High and 1× for Desktop Native on Mac17,16.
The six Chromium slowdowns and JS fits use engine `cf47558ef` and
Driftwood r5. The local dev build serves one cell. Staging v0.1.52 on
the iPhone 13 drew 804k triangles, 110 draws and 167 programs at the
dock. The Chromium sweep drew 708–723k triangles, 84–87 draws and
95–96 programs. The iPhone's update and render medians were 4 and 5 ms.
No measured throttle fits both within 15% on the local scene.

The CPU prices use the calibration page's rig, physics and navigation
samples and its slope fit. Phone prices and the repeat fit are owed.
The only 17 Pro Low Power medians come from cached v0.1.50. A
same-build v0.1.52-or-newer recording is needed for the DF13 profile.

Three frozen Metal poses from the same local build took 0.956, 1.024
and 0.718 ms per GPU frame. The iPhone's corresponding gpu~ p95 values
were 25.7, 0.7 and 3.7 ms. The phone's number includes waits beyond
measured CPU work and the frame cap. DF5 still needs three matched
runs and two held-out segments within 25%.

The table consumes the desktop factors. It reports the phone CPU
profiles as provisional and leaves the phone GPU column blank.

## Nightly capture coverage

DF7 now requires all three cold repeats for each distinct profile
variant. A duplicate could previously fill the total count while a
repeat or a desktop variant was missing. The nightly remains
report-only until DF15.
