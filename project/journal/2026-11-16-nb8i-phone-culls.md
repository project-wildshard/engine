# 2026-11-16 NB8: phone cull pad and faced slab trees (mini-nb8i)

- Nine's benchmax walk p95 sat at 0.86-0.88 M triangles. Peak frames come
  from the hoverboard wedged against an east-market booth: the booth's
  awning and a pillar hide almost everything, yet ~1 M is drawn.
- Placed copies (crowd, lanterns, facade pieces, sets) were chosen for a
  view padded 7° plus a 1 m move. On the portrait phone that kept
  75-130 k triangles outside the frustum. `cullViewPad` 3 on the phone,
  turn and move thresholds scaled with it so the padding still covers
  every pose until the next choice (lossless by construction). Pad 1.5
  bought nothing more.
- mini-nb8h's facing cone cull of slab leaves was lossless but its tree
  built 1.2 s late on the main thread. The faced tree now builds in a
  worker as each chunk is read (`slabTree.worker.ts`); the place tree on
  the main thread stays the fallback and is skipped when the worker wins.
  Spawn 0.82-0.84 to 0.78-0.80 M from control on.
- Walk p95 now 0.82-0.86 M depending on how many laps the board passes the
  booth (the walk's path is not deterministic at x4). Same-instant scene
  A/B against main: 0-13 px at four poses.
- Not done: the canopy-depth draw is alpha-only but `NdJiehua.jiehua`
  reads the scene alpha, so it stays. Next levers: canopy core facing,
  booth set LOD, occlusion.
