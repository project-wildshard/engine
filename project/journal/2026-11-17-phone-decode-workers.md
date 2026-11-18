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

Side finding for EM16, corrected: on Template in Playwright WebKit, WebContent's `WebKit Malloc` grows about 250 MB
between 0.6 and 0.8 s into the boot, while the page fetches and decodes the zone's models. Most of that is the
measuring tool, not the game: Playwright's Web Inspector keeps every fetched response body in WebContent (about 1.34x
the fetched bytes, up to about 200 MB, never freed); a Playwright WebKit launched without the inspector shows none of
it (meta `docs/plans/engine-memory/inspector-retention-2026-11-17.md`). Absolute WebKit [K] numbers from
`measure.mjs` carry that artifact; A/B deltas between two builds on the same zone do not.

## Worker and [K] numbers (EM19)

Workers alive 5 s after control, Chromium phone tier, `99a04b6c` against `15a31ccf`: Template 3 to 1, Nalati 3 to 1,
Pine 4 to 1, Nine 4 to 1 (only the server worker stays). On the grid the far impostor decoder now retires too
(`farImpostorView.ts`, `e3889872`). WebKit [K], `measure.mjs` runs=3: Template settled 551 to 526 MB, peak 682 to 658;
Nine settled 1072 to 1017 MB (noisy, load 30 to 40); Nalati settled 1005 to 965 (n 1).

## One compiled Rapier per page (EM21)

The page compiles Rapier for its own physics (`core/bootstrap.ts` `loadRapier()`, streamed from the first moment of boot)
and the standalone server's worker compiled a second copy from the bytes the page held, then tiered it up again. On iOS
both are threads of one WebContent process. `src/shared/engine/physics/rapierModule.ts` compiles the module once per
realm (`compileRapier`, `compileStreaming`); the page instantiates from it, and `shell.ts` posts the same
`WebAssembly.Module` to the server's worker, in the prewarm message and in the start message, whenever the page has
finished compiling it. The worker instantiates it (`server:rapier-instantiate-shared`) and falls back to its own compile
from the held bytes when the page has none yet. `isWasmModule` checks by tag, since a posted module or a test runner's
can belong to another realm. Tests: `rapier-shared-module.test.ts` (a handed module gives a working Rapier, no compile),
`prespawn.test.ts` (the early worker gets the page's module).

EM21 alone, WebKit [K] runs=3 on Template, `7e092df1` against `15a31ccf`: settled 547 to 523 MB, peak 673 to 667 MB;
the peak does not rise. The worker's trace shows `rapier-instantiate-shared` (6 ms) in place of its own compile.
Physics tests (`test/physics-pose-sampler.test.ts`, `src/shared/engine/physics/`) pass.
