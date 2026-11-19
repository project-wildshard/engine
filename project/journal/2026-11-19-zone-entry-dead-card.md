# Zone entry: one live card, not a dead one on top

> Written by: Claude (opus-tr4b6). QA 11-19 row 17.

Jake on staging v0.1.50 (Mossgate to Mirror Salt, Driftwood to Sky Reach): the zone card froze at "application modules ·
reading build files · 0 / N files", its clock stopped, no button answered. Reproduced on preview v0.1.49 in headless
WebKit at the phone layout. The page made two cards: the entry card (`beginNavigationShell`) was adopted by a Loading
that died at once (its scope hung off the ambient owner, the retired session), so it stayed on top with a dead clock while
the boot ran on a second, fresh card beneath it (z 20 under 71), whose PLAY (Developer hold) no tap could reach. A page
boot's Loading now lives on the engine scope and adopts the entry card; a held card says "Held by the Developer switch ·
tap PLAY"; the stuck watch skips veil copies.
