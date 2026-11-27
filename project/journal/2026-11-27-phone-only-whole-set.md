# 2026-11-27 A fence zone's phone whole set carries its phone-only mounts (SF11, cook 1.19.0)

SF23 made a fence zone's phone whole set its fence plus its own far view, score and sfx. A phone-only mount past the fence
(`.phone.` or `/astc6/` in its URL) was then in no set at all: the desktop sets leave phone-only files out. The pins
install's `public/` copies hid this until SF11 stopped them. Pine's headless Explorer on the phone tier found it: its
`baked/rain.phone.bin` and eleven prop and hero `.phone.glb` LODs were in neither phone set and absent from the cook's store
(a lone ring-2 cook of Pine, 757 keys). Rain and those LODs load in play, so phones would have lost them on staging.

The phone whole set now also carries every phone-only mount past the fence. Three of the 27 fence zones had some (phone
whole set, raw bytes, before and after): Nalati 23 files, 110.4 to 116.6 MB; Nine Dragon 21 files, 79.7 to 82.8 MB; Pine
44 files, 106.7 to 115.4 MB. The other 24 are unchanged. It moves with content (J439).

Cook 1.19.0 records the output change. Guard: the golden fixture `made-up-fence` gains a phone-only mount past its fence
(`baked/rain.phone.bin`), so the golden digest moves with this set, and `test/cook-own-sfx.test.ts` checks the phone whole
set carries it and no desktop set does (it fails without the change).
