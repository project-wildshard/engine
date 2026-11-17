# Isolate Nine street and own its sample

> Written by: Codex
> **State:** validated locally, 2026-11-17.

NB6 street already had job-level continue-on-error, but its cancelled
macOS job still made run 44139343442 red with all blocking jobs green.
Move street into ci-reports, triggered after the source ci completes.
The producer and stock props load remain blocking in ci. A macOS
queue, failure or cancellation can no longer hold or change ci.
Keep the seven-day street JSON/log artifact, including failed runs.

Observe the triggering run's client first. Only when it has no client
may an exact fully green plan proof supply one. Docs-only producers
skip the observation; expired or unavailable artifacts never stand
in for measurements. Actual local HTTP controls cover these paths.

The old runner's separate page evaluation read __benchRows after a
minute, so a lost global caused undefined.at. Keep the sample and
its route in an owned Playwright handle instead, and dispose it after
reading. A replaced world or empty ring explicitly refuses evidence.
An exception writes its phase, load data and error to the JSON report.

Failing-first controls reproduced undefined.at and the absence of a
world-change refusal; the workflow contract failed on street still
being inside ci. Four sampler and four source-selection cases pass;
six unchanged ratchet cases pass. All 77 landing cases also pass.
Actionlint and typed lint pass. Real-client verification caught and
corrected a string-callback API mismatch before push; that failed run
also proved the diagnostic JSON survives an exception.

Final full client from 44142591056 (source 4b77e946), M5 Pro Metal,
phone 402x874 at DPR2, CPU x4, Nine route, full 60 seconds: exit zero,
29.70 fps, frame p95 38.70 ms, GPU p95 5.37 ms, 911237 triangles and
112 draws p95, one complete minute and zero ratchet faults. No
threshold, renderer, pin, bypass, Xcode or licence change. NB6's
physical-GPU CI qualification stays open.

The first normal push gate caught types previously hidden by the
string summary: explicit frame tuples, percentile/window parameters
and a narrowed exception value now pass the full layered compiler.
This correction changes no runtime measurement or threshold.
