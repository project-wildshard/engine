# 2026-11-16 NB8: faced tree for the crown core (mini-nb8j)

- Nine's banyan crown core is one 45 k-triangle plain Mesh drawn whole
  wherever the street sees the tree; about two thirds of it faces away
  from the camera at the booth-pass peaks, which the GPU culls only after
  shading every vertex.
- On the phone, a scene step's big front-sided plain mesh inside one tile
  now draws by a faced slab tree (`partFacing.ts`), through a
  `drawElements` hook and `multiDrawElementsWEBGL`. The slab tree's facing
  split (3 x 3 cells a cube face, below 512-triangle nodes) left out only
  ~100 triangles of the crown, whose lumps face every way within a leaf;
  splitting by facing first, in 5 x 5 cells, leaves out 10-15 k.
- Crown core 45.0 k to 30.4 k at the peaks, 0 px on the crown in a
  same-pose look check. The walk p95 stays route-bound (0.78-0.86 M): the
  stuck-board windows sit at 0.91-0.94 M and need ~130 k more.
