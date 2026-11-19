# 2026-11-18: Dunes rows sim as the program (meta ONE-FORMAT OF11b)

- The ray and strider converted by sharddev `speciesProgramToRows` now run 600 ticks on the declared data host exactly
  as the species program runs them on the keeper: 0 m apart, the same attack phases and states, the same blows on the
  same ticks. Three gaps closed to get there: a strike row's `units` (format 0.44.0; the ray's swoop is in metres), the
  keeper body's `feel.blow`/`cover.checked` tags written by toRows, and a `feel.blow` row landing at the creature so the
  player's knockback matches.
- Left as named differences, not gaps: a declared body also tags its exact species row (`creature.<row id>`), and the
  move id is the strike's rather than the body's contact move. The keeper decides on ticks 1 mod 6, declared brains on
  0 mod 6; the test pre-steps the program host once to line them up.
