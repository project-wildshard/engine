# 2026-11-24: a new link rides portals anew (QA-11-24 row 2)

> Written by: Claude (opus-fp21)

A reload that kept its seat still snapped on Nine Dragon's shared pad: the page's ride was fresh, the room's seat still held the
road the player entered by. The room cannot tell a reload from a blip (both are a held seat's new transport), and a hello field
to say which would need a wire minor. So both sides start fresh on every new link: `DedicatedRoom.rejoin` releases the seat's
portal ride (`releaseSeatPortals`), and the page restores its install-time ride state at the first frame after `NetClient.rejoin`
(`freshOnRejoin` in `portalRideBinding.ts`). A blip mid-ride resets both; a player still on the pad simply rides again.
Tests: `test/portal-ride-rejoin.test.ts` (the page hook); the seat release is `test/portal-ride-room.test.ts`'s.
