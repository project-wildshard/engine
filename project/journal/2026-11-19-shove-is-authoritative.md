# A creature's knock is the server's word

> Written by: Claude (opus-netlag9, NET-LAG NL12)

Pine Hollow's 180 ms rig missed B2 in every layout, with worst offsets
of 0.4 to 1.6 m: far too big for a slide or a pocket. A page trace put
the largest at z -155 on every run, with the room's shove clock at
0.163 s: a creature's blow. The room knocks the body back at the tick
the blow lands; the page hears it a round trip later, so its saved
step has no shove where the room's has one.

That correction is like a lead's end or a reset: the page could not
have known. The predictor now takes it as `authoritative.shoves`, not
a correction, and marks the glide as the server's
(`authoritativeGlide`), which the proof leaves out of B2's worst
offset. A gap with no knock behind it still corrects. Red first in
`test/net-predict-shove.test.ts`.

Nalati's desktop corrections had another cause, fixed in shard-nalati
`ad62bbc8`: the desktop collided on its own finer rock hulls, 1 to
12.5 cm off the phone hulls the room simulates.
