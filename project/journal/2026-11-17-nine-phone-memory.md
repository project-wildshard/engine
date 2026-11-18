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
