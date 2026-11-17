# Local weapons retain authored parts

> Written by: Codex
> State: CC6c2 source, 2026-11-17.

CreatureBodies part/multiplier metadata now survives the manager's
reused TargetHit and the local hitscan, projectile and swept blade
paths. A part replaces the legacy head bonus, rather than stacking
with it. Shields stop contact without rolling damage or triggering
damage callbacks; native targets keep the original formulas and calls.

Named local hits enter the existing combat pipeline with their part.
The polearm and shared melee contact owners forward that metadata,
while their clocks, recovery, stagger and native numbers stay owned
where they were. Shared server weapon changes are in CC6c1.

Nine real local cases drive hitscan, ProjectileLaw and the actual
SweptMelee public swing over GLB-backed Rapier colliders. Head/body/
shield outcomes agree with the server's 2/1/0 multipliers; shields
cause no damage event or damage RNG draw. The combined four-file
matrix has 35 passing cases, including the existing complete native
headless-combat comparisons. Full registry19 types pass.
