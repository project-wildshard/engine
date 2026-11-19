# Declared encounters run beside a runtime plan

> Written by: Claude (opus-of19b2, ONE-FORMAT OF19c0)

Dunes and Sky Reach keep their runtime plan for the quest page and the
held melee (J367 (7)), but their bosses are to become declared `boss`
encounters (OF19c1, OF20c). `admitRuntimeCreatures` refused any declared
encounter, and the quest host's summon only knew the keeper's boss.

Now `installRuntimeCreatures` installs the declared encounters as
`bindShardfileSim` does (phase adds, decision encounters) and returns
them by spawn id; `prepareRuntimePlan` hands those to the quest host's
`mechanics.encounters` beside the keeper's boss, if it has one. The
plan's owner row is optional in the engine: with none the keeper stands
its homes alone, and a keeper boss with no owner refuses. An encounter
the quest page summons (`{ spawn }` in a director stage) waits dormant,
out of the world when `spawned`, until `PhaseEncounter.summon` arms it.

Left: format's `sim/runtime-plan` schema still requires the owner, so a
built Dunes product cannot drop it yet (OF19c0b, a format release and
the engine pin after it).
