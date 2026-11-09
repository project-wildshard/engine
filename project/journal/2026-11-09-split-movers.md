# SR9: mover moments come back on FollowedMovers

The page-sim retirement (`a7b98b01ee`) took the ride transitions and the
endpoint lifecycle with the MoverRuntime: the canoe stopped stowing
weapons, hiding its rest stand-in, sounding and hinting, and Sky Reach's
raised bridge lost its toast (audit C13, C14).

FollowedMovers now reads both off what the page already has. A ride
starts when the server leads this player's body and the carry mover
moves, and ends when the lead lets go, home (-1) if the mover stands at
its rest, else the far end (1). The arrival hint is news only to a rider
who boarded without the arrival flag: the server sets it as they land.
Two players never share one page's ride, since the lead is per player.

An endpoint mover with a declared end pose latches at-end from its rows.
The first row says where the mover already stood (a save, another
player's raise) and makes no edge, so a reload never repeats the toast.
`atEnd` is live now, so the page's `winch-up` observation follows the
server instead of the value it entered with. The quest stays the
server's; the page only toasts.

Proof: `split-repair-proof --only=movers` (also `--play --only=movers`).
A real press boards Pine's canoe and paddles back; the Sky Reach journey
plays keeper, roost, vanes and winch with real input.
