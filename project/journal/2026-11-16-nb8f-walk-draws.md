# NB8 walk draws (mini-nb8f)

- NINE-DRAGON-BENCHMAX NB8: spawn met ~100 draws on the candidate Nine, NB1's walk did not (benchmax minute 1
  p95 115-120). A per-frame breakdown along the walk: the hoverboard, ridden from 10 s on, adds 12 held draws
  (11 board parts plus its depth clear; the halos are transparent double-sided, two passes each). Parts that share
  a material are one mesh now and the additive halos draw in one pass: 5 board draws, same triangles. Minute 1
  draws p95 115 to 110. Benchmax also prints each 10 s window's draws and triangles p95.
- Then two draws: every solid part is one mesh whose vertices carry their part's colour, roughness, metalness and
  emissive kind (a patched standard program: `pulse`'s emissive lights the strip, lamp and inlay, the discs keep their
  fixed cyan), the halos the other; the depth clear is drawless (EP6's empty range). Hover at the spawn 113 to 103 draws;
  the board reads the same in a same-pose pair (only the rain and the pulse's phase differ).
