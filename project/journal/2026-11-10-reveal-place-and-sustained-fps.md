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

J206 review (Codex, one-shot) of both, two MUST-FIXes, fixed: a hidden page or a paused game no longer closes empty
minutes that read as a fall (a frame interval of a second or more, or a paused game's frame, drops the minute under way
and starts the next there), and the first-frame polls settle when the level leaves mid-boot (a cancelled timer had left
the boot's waits open). Its SHOULDs: the boot mark says whether the page actually took the server's place
(`server:first-owner-adopted` or `-unadopted`), a crossing's early return still marks `server:launch-complete`, the
title's Low Power count starts once the title has been built, and minute numbers count on past the kept 120. Tests
cover an idle gap, an fps-only fall, a gpu~-only rise and the numbering. The forced hidden frame after the server step
runs a whole frame (input, fixed steps, update), as readyFrame's hidden frames already do under the same card.

A re-review found the idle fix incomplete: the game passes a frame delta clamped to 100 ms, so a hidden or parked page
never showed a gap. The collector now reads the gap on the page clock between drawn frames (a second or more drops the
minute under way), and a paused frame (passed as Infinity) does the same. Tests: three hidden minutes behind a clamped
delta, two paused minutes. A single real frame of a second or more also drops its minute: a stall, not a thermal trend.
