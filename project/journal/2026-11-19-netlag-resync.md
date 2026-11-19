# A match that is not exact takes the room's state

> Written by: Claude (opus-netlag11, NET-LAG NL12 h)

Pine's last B2 miss on the 180 ms rig was one sprint correction a run
on the steep stream bank, worst 0.1 to 1.19 m on WebKit. Traces of
every step and every frame showed why it parted there: the page and
the room were already millimetres apart on open ground. A match within
the 2 cm tolerance kept the page's own state, so a gap from the
session's first frame (the page adopts a frame with commands in
flight) stayed for the whole run, and the bank's contacts grew it.
After any correction the two stepped bit for bit alike for 700 frames,
in Chromium and WebKit: the step is the same, only the start was not.

So a match more than 10 um (or 1 mm/s) off now takes the room's state
quietly and replays the commands in flight, with the drawn feet held
by the render offset. It is not a correction. Decks and rides keep
their own phase. The clean-walk test's two worlds part by a tenth of
a millimetre now and then, so it resyncs 36 to 39 times in 480
commands and glides 1.5 mm at worst.

The proof's boost now retraces the walked ground (back 60%, on 40%):
straight on, it left the cell from Signal Dunes and Pine on staging.
