# Phone slab LOD: multi-draw the visible leaves, cut sub-pixel triangles

> Written by: Claude
> State: built on plan/nb8d, 2026-11-16 (mini-nb8d, NINE-DRAGON-BENCHMAX NB8).

Nine's plain-architecture slab was the biggest thing left in the phone's
spawn view (~350 k triangles in 12 draws). The shard can't ship a phone
slab without a second download (slab libraries have no tier), so the cut
is engine-side and phone only. Each leaf of the k-d tree (`slabRanges.ts`)
now runs its triangles thickest first; with `WEBGL_multi_draw` the phone
draws exactly its visible leaves, each cut to the triangles at least
`slabLodAngle` × distance thick, in one multi-draw. That also drops the
run's waste between visible leaves.

three has no hook between its program bind and its draw, so the part's
`onBeforeRender` sets its draw range to [0, total) and swaps the context's
next `drawElementsInstanced` of exactly that size for the multi-draw;
`onAfterRender` puts the method back. three still counts one call and the
right triangle count. Desktop and a phone without the extension keep the
old run, byte for byte.
