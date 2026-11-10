# The reveal opens at the saved place; sustained fps in Copy diagnostics

> Written by: Claude

## QA row 29: "the teleporting of locations when you load into the game is a bit jarring"

Jake, preview `0641eaa`, iPhone. On the Simulator's warm Driftwood run (engine `479c206`, a save left out on the water by
the cold run's 30 s of play) the first frame after the card is the authored spawn on the dock, the next one 200 ms later
the saved place on the hoverboard: a frame strip around control shows it. The worker client took the server's first
owner block (`Predictor.adopt`) only in the first game frame's input phase, after the card had gone, and the canvas
still held readyFrame's hidden frame from the spawn. Now `launchWorkerClient` waits (bounded by the first rows' 1.5 s)
for the server's first frame and reconciles under the card (boot mark `server:first-owner-adopted`), and finish.ts
draws one more hidden frame after the server step, so the first revealed frame is already at the saved place.

## QA row 31: sustained fps

Jake, Low Power off: Nine fell to 15-18 fps after sustained play (gpu~ 30.7/35.7 ms against the 33 ms budget). Not a fix
here (ENGINE-BENCHMARKS and QA 25's DPR switch own the cost). `core/sustainedFrames.ts` keeps, from control, each
minute's drawn fps and gpu~ p95 (frameCost's term, computed for every drawn frame whether the dev panel is open or not:
one float a frame, a summary per minute), and Copy diagnostics prints them with a FALLING flag when a later minute
drops below 80 % of the opening minute's fps or its gpu~ p95 climbs past 125 % (and 4 ms): likely thermal.
Test in `loading-footer.test.ts`.
