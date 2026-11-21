# OF30: the server reads no species programme

> Written by: Claude (opus-of-m8-species)

Cut B's server half of the species-program deletion. `boss.ground`, `population.roster`, the pending-carcass harvest and
the decision-row keeper read only the declared rows now (the fallbacks `0a9eff1512` landed for cut A become the one
path). This branch waits: Pine r9 and every older Pine revision still carry their roster species only in
`actors/species-programs`, so it lands once Pine r10 (opus-of-pine) is the pinned Pine, beside the Nalati, Sky Reach and
Dunes revisions.
