# Flat support before prediction

> Written by: Codex

> **State:** implemented locally, 2026-11-16. NET-LAG NL13b2.

A captured Far Reach windmill step gives the page 19.5% horizontal
freedom and the room 9.0%, despite equal velocity. Their feet differ by
0.6 mm in height above six overlapping flat boxes. Rapier picks a
different contact and changes the later wall slide. This is separate
from the pure-floor partial stall and delayed creature contacts.

Start grounded downward moves at the ray-measured, float32 support
plane plus the existing controller skin. Standing rest needs the same
treatment: waiting until the first walking step leaves the earlier
floor drift in the initial pose. Only nearly horizontal WORLD support
on a fixed/static collider qualifies, within one skin of the feet.
Air, jumps, ground-ignoring moves, moving decks, creature proxies,
slopes, absent/phased support and larger gaps keep the previous move.

The captured native case is red on the old motor (8.98% freedom) and
green with this change. A real Player/PlayerSim/NetRoom link at 180 ms
now records one correction at both 30 and 60 fps over the proof's
matched 42.4 s walk/sprint window, from six/four before. Worst offsets
are 1.57/2.04 cm. Predictor tolerance and Rapier nudge are unchanged.

The allocating motor control takes the same behavioral fix, retaining
the raw allocating ray query so it still checks the allocation change.
Page/room hashes follow the intentional J280 motion fix. Every recorded
saved wire and legacy continuation remains identical.
Browser and staging qualification remain separate open plan rows.

The initial 31 targeted cases, lint and typecheck passed. Review found no MUST
regression. Captured red-first contact and real-link correction bars
remain permanent native regressions, separate from browser proof.

The full preflight exposed two scope mistakes at low load. Its 0.9999
normal guard included gentle grades and altered Driftwood's bridge
approach. The flat guard now allows only one part per million of
normal error; the captured windmill cases remain green. Normalizing
a terrain heightfield to a centre-ray plane also added 5.423 mm of
off-axis drift to a straight native walk. Terrain heightfields keep their original
controller contact. A half-degree grade and flat heightfield now have
explicit unchanged-move regressions. The multiplayer test is unchanged.
All three failing native files pass with both fixes, and old saves
again continue exactly. The originally proposed legacy digest update
has therefore been removed.

After correcting scope, all 35 previously red files pass (188 cases),
admitted at load 4.97 with two workers. The capture, link, motion law,
old-save, bridge and allocating-control checks pass too (45 cases in
nine files). Lint, types and CSS are green. No assertion or timeout
was loosened.

The scope review has no MUST. Its missing ray-normal coverage is now
included: a flat prior normal must reject the same new gentle grade.
The room digests above were captured from the corrected native runs;
the page-law course keeps its initial flat-box digest values.

Hosted CI exposed two omitted baseline updates: the 240-tick Ring 1
chains and the eight 40,000-tick motion traces. No native movement
assertion failed there. A control disables only the new rest call on
the same reviewed source and pins, then restores the exact source.
All eight old Ring chains match, and all eight old motion traces pass.
The corrected motor changes five Ring products; its Mac measurements
match the uploaded Linux measurements byte for byte. Both platform
profiles now use those measured values, preserving the other three.

The corrected long traces are re-recorded with their original seeds,
40,000 ticks, required modes and two identical runs.
No tolerances, repeatability checks or mode assertions changed. The
Ring control restored full pins before the trace tests ran; no pins
install overlapped a test. Source/hash metadata and old/new reports
live in tmp/codex-netlag/ring-control-* and traces-old/new-law logs.

The baseline delta review has no MUST. It also checks that the
Linux trace values reported by hosted run 43822358907 match the Mac
re-record. These portability facts remain here after scratch cleanup.
