# Phone slab draws: a stable multi-draw hook, one merged chunk per key

> Written by: Claude
> State: built on plan/nb8e, 2026-11-16 (mini-nb8e, NINE-DRAGON-BENCHMAX NB8).

Review of mini-nb8d's multi-draw patch (`c8bb3817`). It swapped the
context's `drawElementsInstanced` for one draw and put it back in
`onAfterRender`; a draw that threw in between left the swap in place, and
the next part's swap then captured the stale one as "plain" and kept it
for good. It also cached the extension per renderer, which outlives a
context restore. Now one wrapper per context stays installed, is armed per
draw and only fires in the frame it was armed in; the extension is cached
per three `extensions` object (new on a restore); a non-instanced mesh
keeps the run. The k-d build became a generator so a big chunk's tree can
be built over work slices.

Draws: on the phone with `WEBGL_multi_draw`, each frustum-culled slab key's
chunks in one bank merge into one geometry (`slabMerge.ts`) before upload,
and its leaf tree is a sliced job after the loader's settle. The leaf cut
draws only visible leaves, so the bigger chunk costs no triangles, only
saves draws (Nine's 12 plain chunks become 1). Desktop and a phone without
the extension keep their chunks.

Empty chunks: a chunk whose sphere passes three's frustum test but with
no leaf in view drew its first leaf every frame (kept so a parked warm
builds its pipeline). After its first draw it now draws zero copies
(three issues no call) and gets its copies back after the draw.
