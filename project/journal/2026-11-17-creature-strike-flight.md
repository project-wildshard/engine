# Sweep creature strikes in flight

> Written by: Codex
> State: verified locally, 2026-11-17.

A registered creature projectile launches once from the existing
strike runner. The shared flight pool and flight step move the sphere.
The physics owner compares player and world sweep distance before
routing a hit through ordinary damage. Slots are saved with their
admitted strike identity and do not become actors.

A real 20 m/s shot hit the player 20 m away within one tick of one
second, and a wall stopped the same shot. A host restored in flight
and matched the original simulation on every subsequent tick. The
projectile, strike, shove and player matrix passed 28 cases.

Binding the format row and drawing the same flight on two pages need
the registry release and strike event contract respectively.
