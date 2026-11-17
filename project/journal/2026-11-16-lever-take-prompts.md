# A taken lever's takes keep their prompts

> Written by: Claude (opus-brassgun16), 2026-11-16, TEMPLATE-E2E TC-SHIP-d.

On staging v0.1.32 a WebKit probe of Brasscap Mesa found no prompt at the porch rack's restock, the three camp ammo
boxes or the strongbox. Each is a kit.lever take (item action 3), the lever starts in hand, and `spentUses` (TE-ENG6)
spent every take of a held lever; grid copies apply that rule since c479ca02 (TC-E4c). The server restocks a held lever on
its take (TC-E1d, `declaredKitItems.ts`), so the probe ran dry by camp 2 and the marksmen, rushers and Wyrm stayed up.
Now a lever's take is never spent; a racked melee weapon's rack still is. Template 1's rifle rack keeps its prompt as a
restock. Test: `test/racked-prompt.test.ts` (Brasscap's five lever takes), `test/spent-prompt.test.ts` updated.
