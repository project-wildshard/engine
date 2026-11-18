# Nine's phone memory: where the loading peak goes (mini-ninemem, MEMORY-GATES MG10, 2026-11-17)

Probe: `scripts/boot-memory-peak.mjs` (mini-memcal's renderer x2.0, Low). Nine, local builds, Mac mini. One run's peak
moves 850-1030 MB of renderer between runs of one build, so a cut is judged on 3-4 alternating runs.

- Renderer at firstFrame ~720 MB (detailed memory-infra dump): array buffers ~290 (a GC'd heap snapshot holds 144 live),
  V8 main heap ~200, malloc ~150, the rest Blink, canvas, shared memory. The title page alone is ~270 MB.
- GLB views read in place (`rigParser.ts` `splitGlb`): three copied each GLB's whole BIN chunk and then each view out of
  the copy; 61 MB of main-thread copies under the card are gone (278 to 218 MB). Peak mean 950 to 939 MB, inside noise.
- Ruled out by A/B: the phone slab facing tree and far levels (NB8, NB23 b) cost no measurable peak.
- Chromium's GPU-process jump at the reveal (ANGLE Metal, +1.3-1.9 GB) disappears with WEBGL_multi_draw hidden (367 MB);
  the slab multi-draw is what ANGLE Metal holds memory for. Not the phone's meter (mini-memcal), noted for the record.

## mini-ninemem2 (relay), 2026-11-17 evening

- The title page alone is ~52 MB of renderer, not 270: the ~270 MB is the boot's floor by `selected-discovery`/`admission`
  (spawn parts, engine modules, the WebGL context). An empty zone (Template) peaks at ~424 MB renderer (MG11 table).
- Sky Reach's loading peak (~550 MB, ±10 over 4 runs) is a ~120-130 MB spike at `firstFrame`: V8's wasm tier-up (TurboFan)
  of the standalone server's Rapier, reported as `v8/<isolate>/malloc` in every isolate at once (one process-wide zone);
  `--js-flags=--liftoff-only` removes it. Starting the server later only moves the spike to `ready`.
- Nine's peak (~970 MB at `finish`) carries 475-625 MB of JS heap, most of it garbage: 1.2 GB is allocated on the main
  thread before ready (valibot ~240 MB, graph GLSL emission ~140, placement pages ~110, boot-trace writes ~170).
- `saveStorage.setItem` validated each write twice (its own `jsonSchema` parse, then the slot's): boot-trace writes 173 -> 91 MB.
- Since 02aef688 a GLB channel is a view into its file's bytes, so `gpuOnlyAttributes` releasing `normal` etc. freed nothing
  while the kept `position`/index still viewed the same file. Kept channels now get their own bytes when something is
  released. Nine's slab chunks (merged on the phone) now release every channel but position and the index: buffers reachable
  from Nine's scene at ready 117 -> 53 MB. The loading peak did not move outside noise (Nine 970 -> 937 MB, 3 valid runs each;
  Sky Reach 555 -> 551): the peak there is garbage and the wasm tier-up, not these arrays.
- The standalone server's worker now starts at the data step (`prespawnStandalone`) and warms Rapier with a synthetic world
  (`warmRapier`, ~120 ms): the tier-up spike lands at `world`, when the page holds ~250 MB, not on `firstFrame`. Sky Reach's
  loading renderer peak 558 -> 520 MB (4 alternating runs each, 541-573 vs 518-523); the peak is now the main thread's world
  loading (`loadout`), where malloc carries a ~100 MB transient.

## mini-ninemem3 (relay), 2026-11-17 night

- Allocation sampling (HeapProfiler sampling with collected objects, source-mapped; `tmp/mini-ninemem3/alloc.mjs`): Nine
  allocates ~1.15 GB on the main thread before ready, ~630 MB of it in `props`. shard-format's share ~300 MB: placement
  pages ~110 (valibot rebuild + `json.ts` visit descriptors), material graph validation ~100 (`validateGraph`/`typeNode`/
  `toNodes` per compile), post graph ~26, colliders ~24. Also: GLSL emission ~140, save writes still ~85 (store.write +
  slots v.lazy), `dequantizeIntoSpace` ~32.
- Placement pages now go through `placementPageText.ts`: plain exact pages are used as `JSON.parse` made them, the rest
  through format's schema. Placement parsing 110 -> 47 MB of allocation (the rest is the parse itself). It is a copy of
  shard-format `b960e0e1` `placement-page-text.ts` because MG8 holds this engine on format 0.21.0.
- A/B of the placement cut (4 alternating runs each, same build otherwise, phone Low): loading renderer peak median
  1014 -> 1098 MB (old 951-1024, new 1029-1136), heap at the peak 614 -> 725 MB. Live heap after a forced GC at ready is
  275 -> 269 MB and the parsed pages hold 16.1 -> 13.3 MB, so the cut is smaller in every real sense; the peak moved because
  less allocation means fewer major GCs before `finish`, and what waits for one is mostly ArrayBuffer backing stores:
  `Runtime.getHeapUsage` at ready+2 s is 560-725 MB (backing 420-580) and 270 MB (backing 142) after a forced GC. Cutting
  JS garbage alone does not lower this metric; the dead buffers are the lever.
- Main-thread buffer census (`tmp/mini-ninemem3/abcensus.mjs`, ArrayBuffer ctor, slices and `Response.arrayBuffer`; typed
  array constructors and worker replies not yet counted, wrapping those stalls the boot): 163 MB to ready, of which
  `spawnDownload` fetches 72, `rigParser` slices 31, `ownedGeometry` slices 16, `slabLibrary` facedTree slices 17.
- GLSL emission (`glsl.ts`): `late`'s walk shares one scope-chain array instead of a closure and a chain copy per node,
  `samples` keeps one answer per node in its declaring scope instead of a seen-set walk per query, the per-nodes memos
  (readers, selects, arm reach, sampling) live for the graph instead of per program, and `reach`/`branchShared` count in
  loops. One emission of each of Nine's 46 non-toon graphs in node: 190 -> 117 MB allocated. Output is byte-identical:
  `test/glsl-identity.test.ts` checks all 211 graphs of the installed pins against hashes recorded from the old emitter
  (`GLSL_IDENTITY=write` rewrites them when a change means to alter shaders). EM18's 20 MB is not reachable by trimming:
  `build`'s per-node closures and the source strings themselves are most of what is left (~60 MB).
- Clean worktree builds of main 6f97dc82, phone Low, 4 alternating runs (one base run dropped, mislabelled at
  `selected-discovery`): Nine loading renderer peak median 1058 (base, placement wiring removed, old glsl) -> 1141 MB with
  both cuts (phone x2 2116 -> 2282); Sky Reach 489 -> 499 (noise). The placement wiring is undone (`placementPageText.ts`
  stays, unwired, with its fuzz test) until the dead buffers are cut; the GLSL cut stays (byte-identical, not isolated).

## mini-ninemem4 (relay), 2026-11-17 late night

- Buffer census (`tmp/` tool, not kept: every main-thread ArrayBuffer of 16 KB+ by birth site, a WeakRef each; at `ready`
  +1.5 s a forced GC names which died): Nine allocates ~1.0 GB of buffers before ready and ~910 MB of them are dead by then;
  V8 backing stores read ~490 MB at the peak and ~136 MB after one GC. Chromium runs almost no major GC in the boot, so in
  this probe nearly every dropped buffer is still held at the peak. Largest: network body chunks 233 MB (every default
  reader hands each chunk over in a buffer of its own), `contentRead` file bodies 99, meshopt decode outputs 75, the
  member layer's store reads (`exactCopy` `arrayBuffer`) 70, merged slab arrays ~105 (released after upload), spawn part
  bodies 94, three's `Float16BufferAttribute` constructor copies 37.
- JavaScriptCore is different: a dropped 400 MB buffer was freed within 2 s with no other work, and
  `ArrayBuffer.prototype.transfer(0)` frees nothing there (the result keeps the memory until GC); in V8 it frees at once.
  So detaching is a Chromium-only lever; allocating less is the lever for the phone.
- Cut A, `scratchReader.ts`: fetch bodies are read BYOB into pooled 64 KB scratch buffers and copied into their destination
  (spawn parts, `contentRead`, texture packs, `readContentResponse`); `halfAttribute` wraps half-float words where three's
  constructor copied them. Census: chunk buffers 233 -> 11 MB, half copies 37 -> 0. Peak did not move by itself (WebContent
  peak 1,844 -> 1,832 MB [K], noise): the buffers it removes were garbage, not the peak's owner on WebKit.
- Cut B, provoking vertex (in `drawHooks.ts`; codex-memgates EM16 named the owner): ANGLE on Metal rewrote the index data
  of every draw of a program with flat varyings to emulate GL's last-vertex convention, 905 MB of pool buffers under the
  slab multi-draw. On WebKit the renderer now draws in the first-vertex convention and rotates each static indexed
  mesh's triangles once before upload (`a b c` -> `c a b`, same triangle and winding), so flat varyings read the same
  vertex (2.4% of Nine's slab triangles have per-vertex flat values). WebKit, 4 alternating cold runs each: GPU process
  peak 1,719 -> 802 MB, settled 1,617 -> 689 MB [K]; WebContent unchanged; ready time unchanged. Spawn shots at phone
  Low match within the rain's own noise (architecture crop 9.3% base-vs-base, 10.7% base-vs-after, >8 levels).
- Blink is left out: merely enabling `WEBGL_provoking_vertex` in Chromium on Metal held Nine's load ~10 s (`sky` ->
  `props` 0.5 -> 10.3 s, main thread idle; with the calls dropped too, so the extension itself). Gated on the WebKit
  user agent (iOS Chrome and Firefox are WebKit).

## mini-ninemem5 (relay), 2026-11-17 night

- Where WebContent malloc grows in WebKit (`footprint -j` categories in a loop beside the 20 ms kernel sampler, in-page
  hooks on GL calls, body reads and JSON.parse): not shader compiles. Replaying Nine's 135 captured programs on a blank
  WebKit page compiled and linked them all for +13 MB settled, 69 MB peak. The jumps at `sky`/`props` and `shaders` are
  JS heap. Chromium allocation sampling split by card step (ordinals read at each step change): 1,256 MB on the main
  thread before control, of which the boot trace's progress writes were 195 MB (`recordBootProgress` -> save store
  validation on almost every card paint), placement pages 112, graph validation 126, GLSL 70, `isJsonData` 72.
- Cut 1: a detail-only boot trace change persists at most once a second (`PROGRESS_WRITE_MS`); stages, checkpoints and
  statuses still write at once. WebKit [K], 4 alternating cold runs each: WebContent peak median 1,906 -> 1,717 MB,
  settled 992 -> 970; EM11 phone loading peak 2.17 -> 1.99 GB.
- Tried and dropped (WebKit [K], alternating cold runs on one session, not committed):
  - placement pages admitted from their text (`placementPageText.ts` rewired): peak 1,684 -> 1,732 MB (noise or worse),
    as on Chromium for mini-ninemem3;
  - the phone's spawn-view fence one job at a time instead of four: 1,694 -> 1,654 MB, ranges overlap, not shipped;
  - faced slab trees held until 1.5 s after `ws:ready`: the boot's own peak fell (~1,700 -> ~1,540) but the trees then
    ran on top of the boot's uncollected garbage (JSC ran no GC in a quiet page for seconds) and peaked 1,655-1,768
    after control, so nothing was won; `measure.mjs`'s control GC hides this, so judge deferrals without a forced GC;
  - the far levels' Maps and number array as typed id tables (byte-identical output on 40 seeded meshes):
    1,697 -> 1,681 MB, noise.
- Ceilings (experiments, look changes, never to ship): phone `slabFacing` off 1,700 -> 1,504 MB; `slabFarAngle` 0 (no far
  room, no far levels) ~1,700 -> ~1,560. So the faced trees cost ~200 MB of the peak and two thirds of it is the far
  levels, but not their Maps: the suspects are the padded index (0.75 of each chunk's triangles more, CPU and upload), the
  worker's reply and the landing's read-back of a released index (`memorySaver.restore`).
- Simulator (`nine-sim-memory.mjs`, n 1, play/fly 10 s), base c636993f -> cut 1: WebContent native loading 0.825 ->
  0.828 GB (noise), Inspector loading 1.154 -> 1.098; play 0.930 -> 0.939. Spawn shots at phone Low (WebKit, control
  + 8 s): base-vs-base 12.7% of pixels over 8 levels, base-vs-cut 11.3-13.7% (the rain).
