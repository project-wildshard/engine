# 2026-11-23 The bare kind draws its first species (opus-qa2, QA 11-23 #4)

Pine Hollow's Model Explorer drew the night thrall (moss and ferns) on every Boar and Elk variant, on Pine main and on
the OF30 port alike. Pine declares `pine.boar.thrall` and `pine.elk.thrall` as species of their own on the native kinds
`boar` and `elk` (OF23a). TE-ENG7's `pageSpecies` registered every moved species twice: under its page kind and, with an
`@kind` id, under the native kind for older servers' rows. The species service resolves a kind to its last row and look,
so the bare `boar` the Explorer card asks for (`speciesDef(kind)`, `app.species.look(kind)`) was the thrall's, and every
variant id fell back to the thrall's only variant.

Now only the first species declared on a kind (`nativeKindOwners`) keeps the native-kind alias: the bare kind is the
plain species. Live rows already find their own page kind by species id, so the game draws as before. Brasscap's bare
`bear` alias moves from the Dust Wyrm to the tin bandit (`test/species-wire.test.ts`).
