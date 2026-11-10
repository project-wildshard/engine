# VITEST-BENCH VB14: 620 light node files share their workers

Plan: meta `docs/plans/VITEST-BENCH-PLAN.md`, row VB14 (the node:test spike's
top measured win: "`isolate: false` for proven-pure node files"). Lane
`opus-vitestbuild`.

Every test file ran in a fresh Node process (`isolate: true`), so each one
reloaded the same ~1,000-module graph. A third Vitest project, `shared`,
now runs the files in `test/shared-worker-tests.json` with `isolate: false`:
a worker keeps its module graph and takes the next shared file. Setup files
still run per file (Vitest re-evaluates them), so `test/setup.ts` and the
per-file CPU grant in `scripts/vitest-cpu.ts` behave as before. That grant's
exit hook is now registered once per process, not once per file.

**Who is on the list.** A node file was a candidate when it was measured
under 2 CPU-s alone in the VB2 inventory, holds no product (not in
`scripts/test-products.json`) and is not CI-serial, and its source has none
of: `vi.mock`/`doMock`/`hoisted`/`resetModules`, `vi.stubGlobal`/`stubEnv`,
fake timers or a set system time, a write to `process.env`, `process.on`,
`chdir`, `exitCode`, a `globalThis` assignment or `defineProperty`, a dynamic
`import()`, an `install*`/`register*`/`configure*` call, a prototype or
`console` patch, worker threads, child processes or a DOM annotation. That
left 629.

Then the proof, in a fixed order per run: all of them in one worker forward,
reversed and in seeded shuffles, and at six workers. Three files failed
somewhere, each on module state frozen on first read: `client-tile-packs` and
`client-world-residency` read `runtimePacksOn()`'s page-frozen choice, which
any earlier file freezes, and `sim-snapshot-migration` hashes state another
file had touched. Four more files that read the same frozen choice
(`client-tile-registration`, `tile-content`, `control-refinement`,
`entry-spawn`) came off without failing. The 627-file list then passed forward, reversed and two
shuffles in one worker; the final 622 passed 14 more runs (ten seeded
shuffles and two forward at six workers, two shuffles in one worker).

The J206 review (no MUST) asked for a backstop against the other risk: a
shared file passing on state an earlier file left. Two more files came off
for that: `view-lane` measures the process-wide fixed-memory bank, which a
full bank would make pass vacuously, and `spawn-download` asserts on the
download module's page registries. Files that read the frozen pack choice
without writing it stay: no listed file writes the harness slot, so the
choice every listed file sees is the one a fresh process makes. The 620
passed two more seeded shuffles at six workers.

**Measured** (the 627-file list for the first three pairs, the 622 for the last two; 6 workers in a 6-slot grant, paired runs,
`/usr/bin/time` over the whole tree, load 10–30):

| Run | Wall s | CPU s |
|---|---|---|
| isolated (today) | 30.0, 32.9, 36.3, 36.7, 35.8 | 179, 189, 195, 189, 187 |
| shared | 11.5, 13.9, 15.7, 16.8, 14.9 | 53, 60, 63, 60, 59 |

About −68 % CPU (−128 CPU-s) and −60 % wall on these files. A shared worker
peaks at 1.2–1.5 GB RSS at six workers (2.6 GB if one worker ran all 622).

**Gate sequencing.** Vitest hands a reused worker the next file only if that
file is also shared, so `PushDurationSequencer` now runs the shared files as
one block after the isolated ones, still before the all-slot proofs.

**Also:** `scripts/built-product.mjs` loads the shardfile boundary lint (and
with it Vite, Rolldown, sharp and semver) only when a source shard's runtime
is checked. A pinned product read never needs it: importing the module costs
0.10 CPU-s instead of 0.14.

The risk this carries: a shared file sees whatever module state earlier
files left. The orders above catch a file that breaks; they cannot prove a
file that passes would also have failed fresh after a regression. Hosted CI
uses the same projects, so a nightly isolated run is the backstop if one is
wanted. Adding a file: same static screen, then the order proofs
(`tmp/vb14/run.sh` in the lane's notes, meta `docs/plans/vitest-bench/`).
