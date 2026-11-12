# Each declared species draws as itself online (TE-ENG7)

> Written by: Claude

Online, every Brasscap tin bandit drew as the Dust Wyrm, a mound under a DUST WYRM plate. Both species
take native kind `bear`; the `animal` row sent only `kind` and `variant`, the page spawned each row by
kind, and the species service resolves a kind to its last-registered row and look. Wire now has
`animal.species` (shardfile `9382d50`, id 24, additive), the declared spawn's sim spec carries its
species id, and the page registers a species that shares its kind under its own id, spawning rows by
`wirePage.rowKind`. The server still runs each body by its native kind; native bodies send ''.
Spawn-script species (activation slots) still send '' and would collapse the same way if two shared a
kind; none do today.
