# GLSL emission: no closures per node (ENGINE-MEMORY EM18)

> Written by: Claude (lane mini-em21)

EM18 asks for under 20 MB [S] of garbage from GLSL emission on Nine. mini-ninemem3's `664c79bc` took one emission of each
graph from 190 to 117 MB in node and left `build`'s per-node closures and the strings. A sampled node census of Nine's 55
graphs (one `emitClassicGraph` each, after a warm pass, `HeapProfiler` sampling at 256 B with collected objects kept)
put `glsl.ts` at 128.7 MB and the graph admission it calls (`materialGraph.ts`, EM17's) at 132 MB, for 1.5 M characters of
output.

`glsl.ts` cuts, output byte for byte the same (`test/glsl-identity.test.ts`, 211 pinned graphs, and the graph suite):

- `build` made ten closures for every node it lowered (`one`, `two`, `three`, `out`, `same`, `divisor`, `fragmentUv`,
  `sample`, `textureUniform` and the uv thunk). They are made once per program and read the node being lowered from one
  `lowering` record; inputs are all built before it is set, so no nested build replaces it early. 30.5 to 8.7 MB.
- `readers`, `backReaders` and `selectsOn` walked `Object.values`/`Object.entries` and `for...of` the inputs: an entry
  pair and an iterator result per node and per input. Now `for...in` (the same order for these plain objects) and indexed
  loops. 33.7 to 10.2 MB.
- `ownCost` summed its inputs with a `reduce` callback per node; now a loop. 5.3 to 1.4 MB.

In node `glsl.ts` falls 128.7 to 80 MB [S] (79.7-81.6 over three runs). In the boot (headless Chromium, phone Low,
Nine, allocation sampling at 16 kB with collected objects kept, every sample whose stack holds `render/graph/glsl.ts`),
two runs each: 70.3, 70.3 to 46.7, 45.2 MB [S]; the whole boot to control 1,188 and 1,211 to 1,178 and 1,180 MB [S].
The `for...in` walks skip anything not the object's own (the lint's guard), which these JSON node maps never have.

What is left is not closures: `reach`'s sets, `branchShared`'s member lists, the per-scope reader maps, and the source
strings themselves (each statement's temp name, indentation and expression). Under 20 MB needs an emitter that indexes
nodes by number instead of keying maps and memo strings by id: a rewrite, not a trim.
