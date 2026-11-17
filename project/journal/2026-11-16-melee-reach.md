# Kit melee reaches a body's surface

> Written by: Claude (opus-brassgun17), 2026-11-16

A kit melee blow was measured to a body's middle. The Template's Barrow Warden is a scale-3 body 2.25 m round, so a player who runs into it stops about 2.5 m from its middle, past the iron sword's 2.2 m: no swing a player could make landed (sharddev's test put the player 1.8 m away, inside the body). `ItemTarget.reach` (the body's horizontal radius) now extends a blow's range and lane to the body's surface, on the server kit and the page's prediction. Test: `test/item-melee-reach.test.ts` (the player runs into the Warden and swings from where it stops).
