# 2026-11-13 — quest pins in a grid frame (opus-questmark)

> Written by: Claude

Jake on preview, Sky Reach, iPhone: facing away from the Keeper, "◆ KEEPER 88 M" stood ahead over the bridge while the
quest chip's arrow said behind; facing him, no pin. The projection itself rejects points behind the eye; the miss was the
frame. In a grid frame other than the page's home, `liveSession` stands the camera at that frame's render offset (Sky Reach
is one pitch, 562.5 m, south of Driftwood), while the player, the quest markers and so the pins stay frame-local. The pins
projected without the offset, 562.5 m off, so the Keeper behind drew ahead near the horizon and the Keeper ahead fell
behind the eye. The interact pick already takes the same offset off (`pickInFrame`, C39).

Fix: `hudAdapters` exports `pinFrameOffset`, which `liveSession` writes beside `applied`; the pin pass adds it, tests
ahead/behind by camera-space depth (not projected depth, which a reversed-depth camera would let through) and poses the
camera's own matrix first. Behind hides: there is no edge mode, and the chip's arrow carries the direction. Same pass
serves every `hud.pin` (quest markers, declared pins, grapple marks). Not covered: grapple's own in-view test, riding tags
and the loot chip project with the page camera directly; they reject behind points but would sit 562.5 m off in a frame.
