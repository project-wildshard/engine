# FP53b: the runtime plan's home keeper leaves

Only two pins carry `sim/runtime-plan` (Far Reach, Sunscar Dunes), and both keep zero homes and no keeper boss: Far
Reach's roc and Dunes' matriarch are declared encounters. The keeper still installed for each, so it registered a sim
step and a continuation (its stream, tokens and an empty roster) that every live save carried, and Far Reach's
`legacy` think row opted the host into body bands through it.

`prepareRuntimeWorld` now refuses a plan whose keeper would stand a home, a boss, an owner-row body or species, sets the
body bands from the think row itself, and retires the keeper's step id with the new `SimHost.retireAdapter`. A restore
drops a saved continuation under a retired id before it compares registrations, so a save taken before this change
loads and the next save leaves it out (`test/sim-retired-adapter.test.ts`). `installHomeKeeper`,
`installSpeciesHomes`, `prepareNativePopulation`, `installSpeciesEncounter` and `installBossOwnerRow` go with their
types; the floor and death plane were already the declared host's (`installDeclaredWorld`). The Dunes parity test
compared the retired keeper path with the data host, so it goes too.
