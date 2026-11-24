# The arrival's walk proof turns when a wall faces the centre

> Written by: Claude (opus-fp21)

v0.1.81's staging train held on its menu-and-back leg into Nine Dragon
(open-plot-3-0 -> nine-dragon-stack, seed 2374405940): "Walk input did not
move the player within the entry window", feet (563.4, -557.2). That is
4 to 5 m from the zone's centre, on the spawn deck at y 125, so the room
seated the guest by the spawn rather than at the place it kept by the
south gate. The smoke accepts an inland seat.

`arrived()` proved walk input one way only: face the zone's centre, hold
W for 700 ms, and need at least 0.25 m. Nine's spawn (0.95, 125, 7.5)
stands 0.04 m off a wall on its centre side: a seat cannot go below
local x 0.91, and something near (0.9, 7.8) blocks the straight line south.
A headless WebKit probe on staging 1e4f845e reproduced the hold: three
guests went to the main menu and back. The one seated at (0.91, 8.0)
moved only 0.07 to 0.11 m toward the centre on 12 of 12 tries at 43
frames per 700 ms, so frame rate was not the cause. Every other heading
moved it 2 to 3 m. Two guests that walked into the deck's centre corner
held the same way. Whether the leg passes depends on where the spawn
spread seats the guest. That is why codex-ms's single-walker reruns
passed, and why v0.1.78 and the v0.1.79 hotfix passed their Nine rejoins.

The proof's job is to show that walk input moves the player, in any
direction. Its heading now turns a quarter on each try (`proofHeading`:
the centre, left, right, then back). The error names its tries and the
best distance. The same probe, from the centre corner, passed on the
second try. Nothing in the client changed: the deck's walls are Nine
Dragon's content, and 944844aa0 changed only how the server reads a
kept plan.
