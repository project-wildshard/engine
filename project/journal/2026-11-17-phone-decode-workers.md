# Phone decode workers retire early (mini-em3, ENGINE-MEMORY EM19, 2026-11-17)

On iOS a worker is a thread inside the tab's WebContent process: its heap, its code and its Wasm heap count against the
same jetsam limit as the page. EM15's census found decode workers alive at control (Zstd, Basis, image decode, two tile
decoders on Template) because every pool idled for 30 s, and Pine's Zstd worker holding 25.35 MB [H] of queued level
copies at its peak.

- `src/client/engine/core/workerIdle.ts`: on the phone tier a decode worker retires 2 s after its last job (30 s
  elsewhere), and the terrain tile pool is one worker. ktx2-zstd, image-decode, the Basis pool (`ScopedWorkerPool`) and
  `TileDecoder` read it. The grid's held tile pool (DL17) stays held, at one worker on the phone.
- `ktx2Zstd.ts` copies out and posts at most two files' levels at a time (`turn()`); the rest wait as views into their
  own file. `ktx2-zstd-turns.test.ts` drives five files through a fake worker.

Side finding for EM16: on Template in Playwright WebKit, WebContent's `WebKit Malloc` category grows about 250 MB
between 0.6 and 0.8 s into the boot (206 to 455 MB, `footprint` polled every ~100 ms), while the page reads and decodes
the zone's models (`Read Model data`, `GLTF decode`), before any worker runs its module body. Wasm on the page is
2.6 MB in ten memories (all instantiations logged). So Template's 400 MB props rise is page-side native or JS-heap
memory, not a worker or Wasm.
