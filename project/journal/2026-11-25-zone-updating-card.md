# A zone whose packs aren't cooked yet waits on one card

> Written by: Claude (lane opus-fp54b), QA 11-25 row 35

Staging v0.1.89 ran Mossgate r25 in its rooms before the cook had written r25's packs for the build, so the cook index
answered 404. The page marked the zone behind and, on entering, took the J501 funnel: one reload, then REV-BEHIND to the
title. The title's read-ahead of the selected zone then asked `spawnSelection` for the same zone, which navigated again,
and the page bounced title, leave, title: 294 loads in 90 s in a headless WebKit run, black at the end.

Three things changed. `spawnSelection` only leaves for a foreground download; the read-ahead, held checks and part
tables get null. The entering page no longer leaves at all: it puts up a "zone updating" card that asks the cook again
(10, 20, 40, then every 60 s, through the same `placedContent` read, kept beside the behind mark) and reloads only once
the index is there, never sooner than a minute after the page loaded. And `guardBoot` now ignores a funnel error: its
stuck-boot recovery had been reloading the card away a tenth of a second after it showed.

Proof: a local Ring 1 build reading staging's placement file and packs store (whose index for that build 404s), entering
Brasscap Mesa (rooms on r19, build on r18): three loads, the card up 1 s after entering and the same node for 150 s,
checks at 10, 30, 70 and 130 s, no reload.
