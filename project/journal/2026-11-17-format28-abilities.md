# Bind authored knockback and projectile flight

> Written by: Codex
> State: verified locally, 2026-11-17.

Pin registry format 0.28.0 and pass admitted ability distance and
projectile fields from declared brains to the existing strike runner.

The tests start from parsed deer-independent creature rows and let the
real pursuit brain select each strike. A 6 m knockback passes beside a
damage-only control. A projectile lands at 20 m within one tick of one
second, survives exact restore, and stops at a world wall.
