# Driftwood: island-wide meshes drawn by pieces in the view (DF9, mini-driftwood13c)

Driftwood's ground (108k triangles, a 354 m sphere), its merged palms, rocks, hibiscus, seabed and kit were drawn whole at
every yaw, so the grid spawn still drew 435k triangles facing the open sea. The shadow split already cut these meshes
for the cascades; `debug.viewPieces` now cuts them for the view too (one piece per 6k triangles, at most 16), and draws
a mesh whole again when 75% of it is in view. Census at phone Low: 746k / 527k / 435k triangles at yaw 0 / 90 / 180
become 712k / 348k / 255k, for +11 / +3 / 0 draws. It stays off until iPhone 13 pairs decide.

On a cooled iPhone 13 (about 35 °C) the dock holds 29 to 29.5 fps at the 30 cap. The rest are spike runs: about five
frames of gpu~ 22 to 66 ms, the first time the view turns. A 120 s sky refresh did not move them, and neither did
`debug.bootRoadPrograms` (it stays off).
