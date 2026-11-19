# J451. Far Reach can restore a save from its grid exit

Staging v0.1.52 (`cf47558e`) held at crossing 33, Sky Race to Sky Reach.
Three phone WebKit guest replays visited Far Reach first and then took
that crossing. The two Night Market approaches and the return via
Far Reach's north edge all rolled back to Sky Race. The room journal
recorded the gate's completed ready handshake and rejected the move.

Far Reach rev 4 can save a player 251 m from its origin as they step onto
the grid road. The dedicated room used the standalone play area to read
that save, and refused it before seating the player at the new gate.
Use the grid room's frame as well as the standalone bounds when admitting
a saved position. Keep the existing slack and refusal for distant saves.

The regression writes a real Far Reach save at its exit, returns the same
player via the opposite gate and checks the arrival position and the
saved purse. It reproduced “Player position is outside the world” before
the fix. The checked room needs a new staging server build. The v0.1.52
tour remains held, and any new build needs its own complete tour.
