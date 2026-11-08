# Let an atomic shader job progress after a drawn frame

Jake explicitly requested the inherited grid crossing repair in this
publication. J189 reproduced the red on production engine v0.1.1 with
default Chromium SwiftShader: ordinary road movement stopped 80.8 m
before Ember. Draw count advanced from 4205 to 4275 while the same
zero-material job repeatedly re-entered nativeBudgetSpent(6). Its
completed-frame wait resolved, but the next budget check yielded again.
The unpublished candidate reproduced the same failure. Both relevant
source files were byte-identical to the release.

Yield once before that atomic job, then let it run. A slow completed
draw can consume the shared budget before this continuation gets time;
requiring a fresh unused budget on every delivery provides no liveness.
The existing owner check, local slice reset, post-job budget, program
cap, link preparation and GPU completion fences remain. No timeout or
budget is increased and no tile readiness or presentation is fabricated.

The full 28-product build with this single scheduling change completed
in 32.4 s. Real iPhone-size DPR-2 default Chromium and WebKit each used
the title GRID control and ordinary forward/sprint steering through
(0,-281.25), (1125,-281.25), then (1125,-390). Both reached Ember,
earned its actual durable save, and returned through the real title
GRID tap to open-plot-4-1, with ready true, the board closed and pose
within the proof's 3 mm bound. No page error occurred through those
crossing and saved-return checks. The extra missing-art reload remains
a separately recorded native WebKit cancellation case, not a crossing
failure or an exception suppressed by this repair.

The build identifies itself as f4d8dd4-mw7i7u3d because the scheduling
change was deliberately still uncommitted during its real red/green
check. The whole normal pre-push remains required before publication.
