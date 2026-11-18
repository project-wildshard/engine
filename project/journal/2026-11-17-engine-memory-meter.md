# A memory meter to trust (mini-em1, ENGINE-MEMORY M1, 2026-11-17)

Jake (~18:45 Cancún) asked for memory measured from first principles. Meta's ENGINE-MEMORY plan makes kernel
`phys_footprint` of Playwright WebKit's WebContent and GPU processes the truth meter on the Mac, the engine ledger the gate,
and Chromium allocator dumps attribution only. Milestone 1 builds that meter.

- EM2, one kernel reader (`scripts/memory/footprint.{py,mjs}`). The surprise: Playwright WebKit's WebContent and GPU
  processes are XPC services parented to launchd, so the old "new since before" `ps` scan reads whichever lane's WebKit
  started last. The kernel's responsible pid (`responsibility_get_pid_responsible_for_pid`) ties each one to the Playwright
  app this Node process launched. The sampler resets the interval high-water after every read, so a 20 ms sample carries
  the true peak since the previous one. The watchdog, sim phases and load-mem-probe now read through it.
- EM3/EM4, the harness (`scripts/memory/measure.mjs`) and its protocol. Kernel samples are split into the loading card's
  steps by wall-clock time after the run, so a long task cannot hide a sample. One GC and one read left Template's settled
  WebContent 4% apart over five cold runs (one run 20 MB low); two GCs 1 s apart and the median of five reads 200 ms apart
  brought it to 2.8% (545 MB, 540-555), Nine to 2.3% (1,079 MB). Nine's WebKit GPU process sits at 1.70 GB settled (one run
  2.54 GB). The microscope joins memory-infra dumps by order: the returned guid is one higher than the event's id.
  The ladder on one build: blank 46 MB, engine fixed (Template over blank) 852 MB [K] of which the ledger names 61; the
  title alone is 98 MB over blank; Nine's zone over Template 1,853 MB, most of it in the GPU process.
- EM5, the WebGL ledger on every page (`src/client/engine/render/glCounters.ts`). The allocation journal now reports to a
  sink; a counters-only sink (bytes by kind, format and owner, plus the drawing buffer) installs before the renderer's
  first call on every page and publishes `globalThis.__wildshardMemory.counters()` for the harness, so a ledger number no
  longer needs Developer mode. Developer's per-resource journal stacks on top and comes and goes without removing it.
- EM1, the calibration table (`scripts/memory/calibration.json`, `calibrate.mjs`): 0/128/256/512 MB of eleven kinds, three
  fresh-browser runs each, on WebKit, Chromium and the Simulator. Plain memory reads 1.00 everywhere; JS objects cost 1.9x
  the page's 48-byte estimate in JSC and 1.2x in V8. Textures carry a one-time cost on first upload (~57 MB WebKit GPU
  process, ~74 MB Chromium, ~190 MB SimMetalHost) and then ~1.0-1.2x; SimMetalHost holds ASTC at four times its size.
