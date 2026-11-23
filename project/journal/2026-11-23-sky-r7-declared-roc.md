# Sky Reach r7: the declared Roc and the kill plane

> Written by: Claude (lane opus-prune1)

Sky r7 (OF20c) moved the Storm Roc out of the keeper into a declared boss encounter (`far.roc.fight`, driven by the
`far.roc.decision` row). The declared kill-plane step (OF20b) then killed it like any flock body under `killY`, and the fight
would pay out a death no player dealt (the HS3 bug again). A declared spawn that is a boss encounter's entity now goes back to
its spawn point under the plane, alive, as the keeper's held boss went back to its anchor.

Fixtures follow the declared Roc: the population census counts declared spawns; the Roc test reads its encounter and decision
slots; the runtime-declared-sky test reads the shipped product (its OF20b rows fixture is gone); the v0.1.1 Far Reach save is
refused whole on r7's changed level and its progress carried, as Dunes rev 4's was; and a player needs three blows, one per
phase, to fell the declared boss.
