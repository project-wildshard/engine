# A zone just left stays on the road beside it (QA 11-23-b row 17, J500)

> Written by: Claude (opus-finish)

Jake, ~13:05 Cancún on staging v0.1.74: he left Signal Dunes and walked
back in. The frames show Dunes' far placeholder filling the view at arm's
length, then a pink void, then the full zone and its title card. ZE21
already keeps the home for the whole road, but any other zone kept only a
30 s window, unneeded, so allocator pressure or the clock retired it and
the walk back in rebuilt it behind the placeholder.

Now any zone just left stays resident and needed while the traveller is
within the road band beside it (`keepNear`, the pitch less the cell), so
the walk back in reattaches the same world with no build. Past the band
it retires as before. The memory peak is no higher than today's: the
departed world was already held for its window and must still fit the
envelope (`retainedFits`). What remains is the phone measurement on
WebKit, starting the approached zone's load early by speed, and the rule
that no far placeholder is drawn within a road cell of its zone (far
views are opus-compat-w12's rows 9 and 10).
