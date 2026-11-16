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
Page/room hashes follow the intentional J280 motion fix. Only the
legacy walk-strike continuation moves (3.4 mm); its expected endpoint
and digest update, while every recorded saved wire remains identical.
Browser and staging qualification remain separate open plan rows.

All 31 targeted cases, lint and typecheck pass. Review found no MUST
regression. Captured red-first contact and real-link correction bars
remain permanent native regressions, separate from browser proof.
