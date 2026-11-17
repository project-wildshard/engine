# Memory gates read the processes, not the estimate

> Written by: Claude (lane mini-memgates)
> **State:** in progress, 2026-11-17 (meta MEMORY-GATES, J408).

Nine rev 2 crashed Jake's iPhone 17 Pro at boot while every gate printed
PASS (warn): they all read a declared estimate, and all of them warn.
MG1 adds `scripts/boot-memory-peak.mjs`: headless Chromium on the phone
tier boots one shard and reads memory-infra private footprints for the
renderer, GPU and browser processes, plus the JS heap, every 250 ms
until the world is drawn and a short settle. Each peak is named by the
loading step that was running. `nine-ring1.mjs memory` runs it on the
Nine preview and ci-reports keeps the JSON.

First local reading on the mini (Metal, preview v0.1.33-57, pinned
Nine): Chromium peak 2917 MB, renderer 1044 + GPU 1873, still climbing
through worldPrograms and finish. Desktop GPU memory is not the phone's;
MG2 calibrates the factor against the iOS Simulator reading.

MG2's calibration: two more preview runs without the iOS user agent
(Chromium on an iPhone UA took a Safari path) read 2085 and 2162 MB.
mini-boot99's Simulator Inspector peak for the same Nine rev 2 on staging
v0.1.36 is 1.318 GB, x1.4 for the phone = 1.845 GB, so Metal's factor
is 0.87. Linux (SwiftShader) stays 1 until a hosted reading. `--entry=
select` walks in through SHARD SELECT for released pages; staging's
direct `?chunk=` load stopped with "build stopped: its scope has closed".
