# The phone's static vertex channels go to the GPU packed (MEMORY-STRUCTURE STR16)

> Written by: Claude (lane mini-memstruct-m2d), 2026-11-19

m2c's cook flag could not move Pine: its 31 MB of Float32 "#define STANDARD" vertices come from the engine, not the
files. Welds, tiling, colliders and the rest pools read model-space Float32, so the intake widens quantized files, and
generated meshes (terrain splats, creature skins, held items) never were compact. Chasing each consumer would touch a
dozen paths. `render/vertexPack.ts` changes only what the GPU holds instead: a static Float32 channel's upload waits for
the first draw that points at it, where the program names it, and then goes up once packed (normal Int8, colour Uint8,
any other 0..1 or -1..1 channel 16-bit normalized, three lanes padded to four so Metal reads it in place). CPU readers
see the same arrays. A write out of range turns the buffer back to Float32 and re-points its vertex arrays.

Census at phone Low, online: Pine 61.6 -> 47.7 MB GL buffers, 44.0 -> 31.7 B/v; Nalati 49.6 -> 39.8, 40.6 -> 29.5;
Driftwood 41.7 -> 38.9; Nine only 85.6 -> 82.8, since its bytes are ONE-FORMAT's slab and its own out-of-range floats.
Positions stay Float32 (14 MB in Pine): packing them needs each mesh's grid in its transform, a separate change.
`debug.vertexPack=false` turns it off; measure.mjs `--arm2-pin` pairs the two in one build.

## One staging array (02:25 Cancún)

Six locked Pine pairs: GL buffers [L] 58 -> 48 MB (median, 5 of 6 settled each arm) and GPU [K] 461 -> 450 MB, but
WebContent [K] settled rose 595 -> 622 MB. The CPU-held vertex arrays are the same in both arms (22.1 MB), so the rise
is the encoder's own garbage: every packed upload made a new owned scratch array. They now share one staging array,
grown by doubling and let go when the task's uploads end.
