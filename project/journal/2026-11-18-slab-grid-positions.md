# Slab positions stay 16-bit on the GPU

> Written by: Claude (opus-of-em28b, ONE-FORMAT OF-EM28b3)

Slab chunks now put their float positions on a power-of-two grid when they are read: 4-word Int16 (8 bytes a vertex
instead of 12; the fourth word keeps the stride 4-byte aligned, so ANGLE on Metal draws it without a converted copy),
decoded by the part's own scale and translation as RM8.1e's tile grid codec does. The leaf trees, back-face cones and
far levels work in grid units (the far cells are scaled), so the phone's cut is unchanged. Graph `objectOrigin` and
`vertex.position` outputs decode through the codec as well, which they had to for any gridded mesh. A chunk baked on a
grid (OF-EM28b4, not written yet) keeps its words, and chunks merge only when they share a grid.

Review follow-up: the grid step caps at 2^-6 m (a vertex within 7.8 mm), so a chunk over 1 km across stays float; and a
graph whose only codec reads are its vertex position or object origin stays packable on the phone's normalized static
grid, which reads step 1 and origin 0 there. Measured on Nine (headless WebKit, phone Low): slab positions 13.83 →
9.22 MB, ledger GPU buffers 117.4 → 112.8 MB, EM11 loading peak median 1.73 → 1.66 GB.

The GLSL identity record is rewritten on purpose: 58 of 211 shipped graphs read `objectOrigin` or write
`vertex.position`, which now go through the codec (the same pixels off a grid).
