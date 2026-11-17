# NB8: the border shimmer draws only its near sides (mini-nb8h)

The grid border shimmer was one mesh of every cell's four sides, 64 segments each: on Nine's grid 200 sides, 12.8 k
triangles in every frame, with `frustumCulled` off. Its fragment shader discards everything past 150 m across the
ground, so the far sides were vertex work with nothing on screen. `cullFarSides` now writes the near sides to the front
of the index and cuts the draw range to them, choosing again only after the eye moves 20 m (the choice keeps 20 m of
spare reach). Same-instant A/B on Nine (NB1 phone, x4): 0 px at 5 poses, 12-13 k fewer triangles at each.

Measured and not shipped the same day: a back-face cone cull for the phone's slab leaves (the k-d tree split by facing
below 512-triangle nodes, a leaf left out when its whole box sees only backs). Lossless (0-6 px at a 24 threshold), but
it saved 2-4 % at the poses once small facing cells shared a leaf (10 % before, with 79 k nodes and 3x the multi-draw
ranges), cost 35-55 % more CPU in the sliced tree build, which then finished after control, and left NB1's walk p95 at
0.91-0.92 M. The slab size cut at 0.0015 / 0.002 rad: -10 / -24 k at spawn for 43 / 149 px.
