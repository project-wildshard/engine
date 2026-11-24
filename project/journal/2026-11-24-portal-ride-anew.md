# A seat its player left rides portals anew

> Written by: Claude (opus-fp21)

The J476 tour's Nine Dragon return held because the page and the room
disagreed on which road deck the square's exit pad leads to
(`2026-11-24-nine-portal-deck.md`). The cause is in the engine.

The walk-in portal ride keeps `entered`, the road a player came in by.
The square's way out is the exit bound to that road (`exitFor` in
`walkInPortalRide.ts`), and Nine's four roads share one exit pad. A page
boots with no road entered, so it uses the first road, which is north.
The room's ride for the lead seat is bound once, at install, to the lead
body. A dedicated room keeps that body and parks it when its player
leaves. So the next player in that seat, or the same player back from
the main menu, rode with the last occupant's road. After entering Nine
by the south road, the room seated the player on the south deck, while
the page had drawn the north one.

A player sees this. Nine's fade is 0.28 s out, 0.12 s hold and 0.4 s in.
The page moves the player at full veil, and the room's move arrives
about 0.2 s later (staging 1e4f845e frame log). By then the veil is
fading in at about 80%, so the jump from north to south shows through
it, and the camera snaps because the gap is past the glide distance.

`releasePortalRides(host, player)` (the room calls it as `releaseSeatPortals`) now returns a seat's ride to the
state it had at install. `DedicatedRoom.clearLead` calls it with the
taming release, so the next occupant rides anew, as its page does.
Other seats' rides already started anew, because the room removes their
bodies. A reconnect that keeps its seat (a network blip, the same page)
keeps its ride on both sides, which is right.

`test/portal-ride-room.test.ts` rides Nine's road portal on a real host,
releases the lead and checks that nothing is entered and no rides are
kept. A bot's seat is forgotten the same way.
