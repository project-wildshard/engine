# 2026-11-19: the Bag map opens on your zone

Lane: buddy-engine (QA-FEEDBACK-2026-11-19 row 57).

Row 31 (J455) opened the grid map on you at 3.5 cells across, the 2x chip. Jake, 16:19, asked for 4x. Then at 16:21,
with a screenshot, he said not the full 4x: open with the zone filling about 72% of the map's width, a rim of every
neighbour (road, gate, a slice of the next zone) on all sides, centred on you.

Measured on his screen, the 500 m zone is 571 of 795 px. In this map's chip scale (1x fits the 7 by 7 of 562.5 m
pitches) that is about 5.7x, so it sits past the 4x chip, not between 2x and 4x as the relay put it. I followed Jake's
measure. `openZoom` now solves for the zone filling OPEN_ZONE_FILL (0.72) of the frame's short side: about 694 m
across, a 97 m rim on each side. That is the 62.5 m road with both halves, then about 35 m of the next zone. The
1x/2x/4x chips are unchanged until Jake picks their new labels from the map board. The clamp and the centring on you
are as before, and map-view.test.ts pins the 72%, the rim and the corner-cell open.
