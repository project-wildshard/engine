# Slab positions stay 16-bit on the GPU

> Written by: Claude (opus-of-em28b, ONE-FORMAT OF-EM28b3)

Slab chunks now put their float positions on a power-of-two grid when they are read: 4-word Int16 (8 bytes a vertex
instead of 12; the fourth word keeps the stride 4-byte aligned, so ANGLE on Metal draws it without a converted copy),
decoded by the part's own scale and translation as RM8.1e's tile grid codec does. The leaf trees, back-face cones and
far levels work in grid units (the far cells are scaled), so the phone's cut is unchanged. Graph `objectOrigin` and
`vertex.position` outputs decode through the codec as well, which they had to for any gridded mesh. A chunk baked on a
grid (OF-EM28b4, not written yet) keeps its words, and chunks merge only when they share a grid.
