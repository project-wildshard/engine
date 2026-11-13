# Stuck in Mossgate's pond (opus-pond)

Jake, 2026-11-12, preview 243820b7: "glitched into the pond cant use shift to surface".

- The water law went dry the moment a swimmer left a body's mask. Mossgate's 5 m pool circle ends before its
  crater does (the 257² lattice smears the cliff ~2 m past it), so a swimmer at the bank under water dropped into a dry
  pit under the waterline, slid back in, and went dry again every few ticks: the head never came up and SURFACE had no
  step to act in. Now the mask's edge over deep ground is a wall; over a shore it is still the way out (swim.ts).
  `test/pond-surface.test.ts` is red without it (300 ticks under, 38 swim/foot flips on one bearing).
- The pit itself is shard geometry: a swimmer held at the edge still has no beach. Template's bowl is graded in sharddev.
