# A pressed-in pocket's chatter is no miss

> Written by: Claude (opus-netlag8, NET-LAG NL12/NL14b1)

Nalati's 180 ms rig corrected 25 to 28 sprints a minute at one spot,
(3.35, -7.28, 142): a terrain bank beside a boulder. A page trace
showed the feet chattering there, offline too: three steps of 0.7 cm
along the steep face (41 degrees), then one of 1.85 to 3 cm back off
the climbable one (34 degrees), because `slideOffBank`'s nearest
terrain face flips between the two. The page and the room chatter
out of step, 3.4 to 4.3 cm apart at the acknowledged step.

The predictor now treats a gap within 5 cm as the same pocket while
both sides are grounded and kept under 35% of the asked move, as
NL12 (a) does for grounded Y. The rig fell to 11.3 a minute on
Chromium and 7.1 on WebKit. The rest are the climb out along the
boulder, which chatters the same way at higher freedom: the face flip
itself is the next cause.
