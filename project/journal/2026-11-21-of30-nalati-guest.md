# OF30 (Nalati): the guest projection from a declared row

> Written by: Claude (opus-nalati2)

Nalati's night riders run the balbal's actor projection on the page (`species.program(guest)` in timed encounters) and
on the server (`prepareSlots`); both read it from the species programme's look book in `actors/sheep.json`. Format
`fbbd778c` lets a declared species row carry `projection`. `speciesBehaviour` and `prepareSlots` now prefer the
declared row of the guest's kind and fall back to the look book, read as data so the engine still pins format 0.67.0.
Nalati's next revision sets it on its cooked `nalati.balbal` row; then the look book's copy can go.
