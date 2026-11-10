# VITEST-BENCH VB10: one parse for the declaration consumer proofs

Plan: meta `docs/plans/VITEST-BENCH-PLAN.md`, row VB10 (J227: "one shared
`tsc --build` replaces the 36 per-file declaration runs").

31 of the `*-declarations` files had the same shape: a few
`transpileDeclaration` cases, then one consumer proof that compiles an
unwritten consumer file twice (accepted, then with refusals appended) and
counts the diagnostic codes. Each compile built a fresh program, so every
file re-parsed the TypeScript libraries and most of the engine: about 4.5
CPU-s a file, 140 CPU-s for the 31.

A `tsc --build` or one union program cannot carry these proofs. A build has
no way to say "this consumer must be refused exactly five times", and a
union program of all 62 consumers is not the same proof: measured, 30 of 31
consumers keep their exact codes, but `isolated-engine-constant` loses two
of its four readonly refusals (TS2540) and gains a TS2322 once other
consumers' imports share its program.

So each consumer still gets its own program over its own import graph, and
only the parsed and bound source files are shared, the way a language
service shares them between projects (`src/test/engine/declarationConsumer.ts`).
The consumer's own text is never cached. Every original file is now a
`describe` block in `isolated-engine-declarations.test.ts` or
`isolated-game-declarations.test.ts`; each test body is byte for byte the
original except the compiler-host lines, which became one helper call.
Checked by brute force before the move: all 31 consumers give identical
codes fresh and with the shared parse.

The other five declaration files (project-wide emit, the app project,
JSON companions, generated sources, ambient life) have different shapes and
stay as they are.

Ring 2 stays ring 2: ten of the game files were in `test/pins/ring-2-tests.json`,
so hosted ring-1 runs skipped them. Their blocks live in
`isolated-game-ring2-declarations.test.ts`, which takes their place in that list.

The recorded clocks follow: `test/durations.json` and `test/durations-ring1.json` drop the
31 folded files and record the three new ones and the two hold files from a local
one-worker run (bootstrap data, as hosted timings replace it).
