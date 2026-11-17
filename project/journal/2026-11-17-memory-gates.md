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
