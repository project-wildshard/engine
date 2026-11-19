# Open plots stay on the grid

Jake saw Thin Ice in Zone Select on v0.1.50. Staging marks all 17
open plots as unlisted, but the signed placement file added Thin Ice
to the player deck. Zone Select now honors the unlisted flag. The
placement still adds the grid cell and Developer still gets its card.

The deck and signed-placement regressions failed before the fix.
Afterward, 56 focused tests passed, including Thin Ice's grid entry.
