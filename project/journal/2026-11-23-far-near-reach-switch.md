# J500 rule 3 waits for rule 2

> Written by: Claude (opus-compat-w12), 2026-11-23

Rule 3 (`45b9b07ff`) hid a neighbour's far proxy within one road cell of it. With nothing yet
drawing the zone itself there, the road board showed empty sky where Nalati, Pine and Far Reach
stand, worse than the wedge it replaced (coordinator). The hiding and the near plan's reach now
wait behind the device slot `debug.farNearReach` (off by default). Rule 2's commit (the early
full load, opus-finish) turns it on and proves it with the real zone drawn in that slot.
