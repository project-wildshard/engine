# Data cell creatures get health bars (TEMPLATE-E2E TC-B10)

Jake played Brasscap on staging on his iPhone (2026-11-15 ~21:12 Cancún): "They have no health bars. I can't shoot them."

- A grid data cell (Brasscap, Mossgate) draws its server-owned creatures in `grid/neighbourLife.ts` as bare skinned
  meshes. Combat's bars, damage numbers, the touch aim assist and LOCK all read the page's `RowBodies`, which holds
  none of them, so the fight had no feedback and the thumb had no help. The server's hits did land: a desktop probe on
  staging killed a bandit in three shots.
- The wire's animal rows already carry `hp` and `flinch`; `netNeighbourRegion` now passes them on. Each drawn body is a
  `CreatureTarget`, joined to Combat (`addCombatTargets`) and to the aim assist and lock-on (`addAimTargets`) through
  sources the life owns and drops with its scope. A fall in the row's hp is a blow: the bar holds, the number floats
  (`reportCombatHit`) and the body flinches.
- Full hp comes from the species variant's `hp` (rows do not send a maximum).
