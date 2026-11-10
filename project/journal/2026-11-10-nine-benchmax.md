# NINE-DRAGON-BENCHMAX NB2-NB6: cut Nine's named load stretches

Jake, 2026-11-10 (J235): "we can do the same thing fucking again for
benchmaxing Nine Dragon … low power likely, great, do that." The plan is
meta `docs/plans/NINE-DRAGON-BENCHMAX-PLAN.md`; the loop is NB1's
`scripts/loading-flow/benchmax.mjs` (headless Chromium, CPU x4 / x8).

- NB2, props. The phone paste read props as "WebP paint decodes queued on
  one image worker". A CPU profile of props on NB1 (`--profile`, new) says
  otherwise: props is main-thread CPU, ~90 % busy at x8, and the paint
  array never used the worker: `loadLayers` decoded and read back its 12
  WebPs on the main thread. The largest named cost was the material graph
  compiles, 87 of them, 2.7 s profiled, with Nine's architecture graphs
  compiled three times each (one per material catalogue the world builds).
  Now: a graph file's validation is kept by hash and admitted lists
  (`clientGraphs.ts`), its lowering by the validated IR and the emitter
  options (`glslMaterial.ts` `emittedGraph`), its texture refs by hash; the
  paint layers decode and read back in the image worker
  (`decodeLayerTexels`, OffscreenCanvas; the old path stays when the worker
  can't). Every compile still makes its own material and uniforms.
- NB3, readyFrame. Its spawn view now names its parts in the boot
  timeline: `app:spawn-view-frame` (the hidden frame), `-tiles` (the
  settle's attaches), `-fence` (the fence jobs). Listed in diagnostics'
  named operations, so a paste keeps them.
- NB4, modules. The script memory bank reserved 45 Wasm memories (each can
  cost JSC a full GC, e472f34069) on every page; Nine's standalone page took
  1 of them. A standalone page now reserves 7; the grid keeps its 45.
- Harness: `--profile` (a Chromium CPU profile, tap to control), the full
  boot timeline in `--json`, readyFrame's named parts, the bank census,
  `--dpr`, per-minute rows for NB5's 10-minute run, and the shadow pass's
  share of draws and triangles.

- Paint layers commit: the worker reply carries `texels` (a
  Uint8ClampedArray, transferred); a layer job never marks bitmap decodes
  unsupported.

- Memory bank commit: the reservation moved after `preparePageResidency`
  (the route is known there), still before admission.

- Harness commit: benchmax.mjs options above; its numbers go in the plan.

- Codex J206 reviews of NB2-NB4: no MUST-FIX. Follow-ups: one IR keeps at
  most 4 lowerings (toon params move with the day);
  `scripts/loading-flow/layer-parity-proof.mjs` decodes all 9 of Nine's
  paint layers both ways from the served build: byte-identical in
  Chromium and in WebKit; readyFrame's minimap and horizon jobs get their
  own spans from their start (`app:ready-minimap`, `app:ready-horizon`).
- Numbers, NB1 harness, Mac load 11-17: CPU x8 props 12.1 s median ->
  11.4 s (3 pairs, every pair lower, -0.7 to -1.7 s); CPU x4 props
  4.5 / 4.5 / 6.1 -> 4.0 / 4.2 / 6.1 s. The x8 profile: graph compile
  2.7 -> 1.5 s, graph JSON 0.52 -> 0.16 s, paint read-back off the main
  thread. Reservation 0.58-0.63 -> 0.04 s at x8.
