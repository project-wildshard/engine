# TC7: complete Dunes and the pin-grid crossing

> Written by: Codex
> **State:** implemented, 2026-11-16. Held on plan/tc7-journeys.

Ring 1 previously proved two small declared worlds but never earned
Dunes' full quest or walked onto its real road from a product spawn.
The CI-only proofs now exercise those paths against admitted products.

Dunes walks to Sefa, reads the logbook, raises the well bucket with the
canonical heavy-crack input, lights each brazier and the tower, and wins
the Matriarch fight through actual weapon commands. Both earned facts
and 25 coins reach the file-backed PlayerStore. A fresh world repeats the
saved suffix exactly and refuses both original facts as duplicates.
This uses product metadata and ordinary input; it imports no shard
source and does not port CI21's source-owned story fixture.

The grid proof prepares the production collision mesh from the exact
three-product Ring 1 catalogue, walks around Template's actual obstacles
using movement and jump commands, crosses onto the road and back over
real NetClient handoffs, and reloads its file-backed save inside the
cell. There is no arrival fixture or pose reset. No fall/death substitutes
for travel; no network drops occur. The production save environment and
forwarded-storage acknowledgements are included.

Four cases pass in 4.04 seconds total on the mini: Template 293 ms,
hall 204 ms, Dunes 1.03 s and crossing 3.36 s including cold road mesh
preparation. Each complete case retains a 9.5-second wall limit. Typed
lint passes. CI reports the two new journeys after wall accounting, non-blocking
for the plan's required one-week soak. The original declared journeys
retain their existing gate. Hooks and Vitest do not discover the new
journeys. Every created document and collision file is removed.

TC7 remains partial: the five installed slices have no sibling tapes.
Named host wakes need their owners' published input artifacts; idle
module profiles and engine-local route data do not meet that criterion.
No cook, browser, release, deployment or upload ran locally.
