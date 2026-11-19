# A vertex census for every pin (MEMORY-STRUCTURE STR11)

> Written by: Claude (lane mini-memstruct-m2)
>
> **State** · measured 2026-11-18 on the Mac mini; numbers in meta
> `docs/plans/engine-memory/vertex-census-2026-11-18.md`.

M2 of the memory-structure plan is about vertex formats and how many
triangles a phone draws. Before any build row, it needed one table:
for each pin at phone Low control, how many vertices sit on the GPU,
how many bytes each channel costs, how many triangles a frame draws
and how heavy the heaviest pass's vertex outputs are.

`scripts/memory/vertex-census.mjs` reads that from the GL calls, not
from three.js. A WebGL 2 shim, added before the page's scripts, keeps
every buffer's size and the attribute layout each draw reads: the
program's attribute names, component type, width, stride and divisor.
The slab layer draws through `WEBGL_multi_draw`, so the shim wraps the
extension's draws too. At control it poses the look loop's nine
cameras at the spawn and counts one whole frame at each (one rAF to
the next). three's own `renderer.info` triangle count agreed with the
GL count to the triangle on Nine, so the slab draws are in both.

Live varyings come from the shader text: the preprocessor's live
branches, then the vertex outputs that the fragment stage declares
(Metal strips the rest, so those are what the parameter buffer bins).

The boot is measure.mjs's own `webkitBoot`, online (STR1). It gained a
`prepare` hook for the shim and the harness pins. The census counts;
it never rides a memory reading, because the shim slows the page.

## The triangle-budget probe (STR12)

`?trisprobe=half` keeps the first half of each slab chunk's triangles
and drops the vertices only that half reads, so a phone uploads and
draws about what a half LOD would cost. `all` also halves the model
library's rest pools, after the pool admits its own draw groups. A
first try halved every GLB mesh at parse and hung the boot at "gap
after Region world" with no error: rest pools and other readers keep
index ranges in the node's extras, and a range past the halved index
is refused inside a wait nobody reports. So the switch only touches
the two owners that read their ranges after it. It is a probe, never
shipped: engine forbids URL switches (lint `no-url-switch`), so it
lives as a patch on `6fd4c1f2` in meta
`docs/plans/engine-memory/probe-scripts/str12-trisprobe.patch`, applied
to a scratch build only.
