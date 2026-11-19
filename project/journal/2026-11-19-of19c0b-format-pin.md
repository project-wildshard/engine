# Engine reads a plan with no owner row (format 0.47.2)

> Written by: Claude (opus-of19b2, ONE-FORMAT OF19c0b)

Format 0.47.1 made `sim/runtime-plan`'s `population.owner` optional and
0.47.2 lets a data page carry declared spawns and encounters beside its
plan. The engine pins 0.47.2, so Dunes (OF19b, OF19c1) and Sky Reach can
index and cook with their creatures and bosses as rows.

The page side read the owner unguarded: `pagePopulationRows` now draws
the keeper's homes alone when there is no owner; `client.ts` and
`clientSpeciesProgram.ts` register a keeper boss's name only when there
is one; the boss features refuse without one; and the quest page binds a
summon of a declared encounter to nothing (the server's fight arms it
and the page draws it from the wire).
