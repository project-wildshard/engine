# Driftwood water outside its grid cell

> State 2026-11-23. `debug.waterGridTrim` is a phone Low trial. The uncapped DW1 floor is tracked in meta DF19.
> Written by: Codex

The previous fast DW1 fight moved roughly 157 m between the 3 s and 4 s samples. The slower run stayed on the beach, acquired a boar and chased west. Its camera path was reconstructed from the player positions. A fresh replay records live boar lock and swings before playing the same camera keys in each arm.

On the fixed path with a 390×658 DPR 1 buffer and ANGLE Metal, the scene pass GPU p95 was 7.09 ms. Omitting the ocean in selected whole-pass queries brought it to 3.65 ms. Omitting the cove's big batch read 4.50 ms and its casters 4.94 ms. These were separate ablations of the scene.

Driftwood r9's admitted ocean graph discards fragments outside the grid water extent in its undeformed rest coordinates. The phone Low slot omits triangles outside a common edge. The retained indices preserve their original order and refer to the original vertices. The full geometry is available for broader water extents, translated meshes and a switch to High. The graph file hash restricts the optimization to the audited discard rule.

The live prototype changed 43,337 ocean triangles to 13,409 and its scene GPU p95 to 3.84 ms from 7.10 ms. The engine keeps a conservative margin and draws 14,217. Fenced modeling on the interleaved prototype read 18.67/21.30 ms p50/p95 off and 19.05/21.84 ms on. The slot remains opt-in while the calibrated route and phone pairs establish the effect on frame time.
