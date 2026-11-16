# A taken rack's prompt goes

TEMPLATE-E2E TC-E4c (opus-brassgun9). Mossgate's sword rack kept "Take the iron sword" after the take. `spentUses`
(TE-ENG6) spent only a lever's rack; it now spends a racked melee weapon's rack once it is taken too. A grid copy's
prompts (`copyPrompts`) had no spent check at all, so a lever rack or a lit brazier kept its prompt in a cell. They now
take `copySpent`: the copy's public shared fields off the wire's rows, and a rack taken when its owned line says so. WebKit on
`/slug/_template`: the prompt reads "Take the iron sword" at the rack and is gone once the sword is in hand.
Test: `test/racked-prompt.test.ts`.
