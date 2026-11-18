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
  EM5's checks on Template at control (Chromium, ANGLE Metal): the ledger's buffers equal `webgl/context_*/buffers`
  exactly (15.30 MB). Its WebGL total (33.5 MB) does not match `gpu/angle/metal` (110 MB): ANGLE Metal holds 36 MB before
  the engine's first allocation and ~41 MB more than the API asked for by control; that gap is EM8's to name. NB1 on Nine,
  three alternating pairs: frame p95 42.6 ms with counters off, 41.3 ms on.
- EM6 and EM7 (mini-em1b), one owner per buffer and workers that report in. `ownedBuffer.ts` makes, copies or adopts a
  CPU buffer and counts it in the RAM ledger under an owner and kind, whatever its size: on Template the kept geometry
  arrays average 26 KB, so a 64 KB floor would have left most of them out. A new census (`scripts/memory/census.mjs`)
  wraps every way a page or worker makes an ArrayBuffer, holds each weakly, and at control lists the live ones by site and
  ledger owner. Its first finding: Template's `partition_alloc/allocated_objects/partitions/array_buffer` (35.8 MB) is the
  census's 32.5 MB rounded up to PartitionAlloc slots (35.4 MB in four buckets an order), so no capacity ledger can sit
  within 10% of the partition itself; against what the page asked for, the ledger is at 93% (30.4 MB). The ground merge's
  member arrays (13.4 MB) were the largest holder the ledger did not see. A typed view over a wasm memory names the
  memory's own buffer, so the census leaves those out. Workers post their ledgers on a BroadcastChannel from
  `installWorkerBootTiming`, so every engine worker reports without touching its message protocol.
- EM8 (mini-em1b), the closure. `measure.mjs --closure` predicts WebContent and GPU-process [K] at control from the
  ledger times EM1's weights and splits each process by `footprint -j` category. The first thing it found was that the
  category names are the VM tags', not what holds them: in Playwright WebKit a 200 MB ArrayBuffer lands in "WebAssembly
  Memory" (JSC's primitive Gigacage) and a 200 MB `WebAssembly.Memory` in "WebKit Malloc". With that mapping the
  ArrayBuffer category closes: Template 44 MB measured against 41 MB of ledger, Nine 114 against 104. The whole
  process does not: the ledger predicts 13% of Template's WebContent and 27% of its GPU process. The gap sits in WebKit
  Malloc (the JS object heap and WebCore, 428 MB on Template, 810 on Nine) and in Metal's IOAccelerator memory in the
  GPU process (about 100 MB on Template, 1.1 GB on Nine). A probe on a blank page says ANGLE Metal costs 1.0x for
  textures and aligned buffers, 1.33x with mips, 3.2x for an int16x3 attribute, and about 0.1 MB a program, and Nine
  has 65 programs and 0.6 MB of unaligned attributes, so neither explains Nine's GPU gigabyte.
- EM9 (mini-em1b), anchors that need no cable. The calibration page moved to `public/memory-calibration.html`, so the
  client build serves it at `/memory-calibration.html`, and gained a tour: `?tour=1` runs each kind's staircase in turn,
  and every reload records the kind before it at its last step and starts the next. A phone that kills the page leaves
  the kill line in `localStorage`; one that does not reaches `max` and reloads by itself. And each boot checkpoint now
  carries the ledger's totals by kind in MB, so the "Abrupt previous page" report of a killed boot says what the engine
  held at its last step, not only which step it was.
- EM10 (mini-em1b), the real-device readers, written before any phone was plugged in: `scripts/memory/iphone-footprint.sh`
  runs pymobiledevice3 through uvx for the WebContent and GPU processes' `physFootprint` every 500 ms, the syslog lines
  that state the limit and its crossing, and afterwards the newest JetsamEvent report as a table. The parsers are tested
  on a synthetic JetsamEvent and syslog sample; the first real phone run will say whether the field names hold.
- EM11 (mini-em1c), the phone chain that replaces "Chromium renderer x 2.0" (`scripts/memory/phoneModel.mjs`,
  `phone-model.json`, refit by `phone-fit.mjs`). Phone WebContent = native WebKit WebContent + alpha x the GPU process over
  its floor, since iOS charges the page's Metal and IOSurface memory to WebContent. `measure.mjs` now stamps the boot
  trace's checkpoints (the operations an "Abrupt previous page" report names) on the kernel samples, so v0.1.36 Nine's
  death on the phone right after its last `compile:after` bounds alpha from both sides: over 2.05 GB in that window, under
  2.147 GB in every window before. alpha 0.14-0.47; a single scale on both processes fits 0.58-0.82, and the bar is both.
  The Mac's own WebContent alone read 1.79-1.84 GB in the death window, so the GPU side the phone charges is small next to
  what Mac ANGLE Metal holds (1.7-1.8 GB). On main `c4397636`, phone loading peak / playing: Template 0.82 / 0.63 GB, Dunes
  0.95 / 0.66, Pine 1.45 / 1.18, Nine 2.42 (2.06-2.91) / 1.50: Nine still crosses the line while loading. The probe's
  factor is the fitted 2.25 (1.14-2.86) of its renderer peak.
- EM12, the meter in CI, report-only (J400: ci-reports, never ci's verdict). The macOS `nine-street` job installs Playwright
  WebKit and runs `nine-ring1.mjs measure`: three cold native-WebKit boots each of Template and pinned Nine on the exact
  client ci built, the kernel footprints, the ledger and EM11's phone chain as a table in the step summary. A new ubuntu
  `memory-ledger` job runs `nine-ring1.mjs ledger`: Template's ledger [L] in Chromium on SwiftShader at control and at its
  peak, exact bytes for a later ratchet. `measure.mjs --ledger-only` and `--summary=<file>` are the two new switches.
