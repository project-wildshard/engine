# Correction batches on the rope deck

> Written by: Codex

> **State:** verified locally, 2026-11-16. NET-LAG NL8b4, J280.

The existing deck test crosses a live Rapier rope chain with the real
Player, PlayerSim and predictor. It injects owner feet 0.3 or 1 metre
below the page's deck, but delivers an owner frame every fixed tick.
That does not exercise a slow drawn frame collecting several packets.

The new cases keep fixed simulation at 60 Hz and deliver owner frames
only on 60 ms boundaries, comparing only the newest owner block as
NetPlayer does. Walking and sprinting each cover three
delays and both injected errors. They require a batch of at least
three owner frames, positive correction counts, no checked pose under
the existing deck bound, and arrival at the far end. The original
single-tick limits remain unchanged; their floor checks are stricter.

This is native correction-batching coverage. It does not replace the
parent plan's browser/staging walk with forced slow rendering. No
gameplay code, movement parameters or correction thresholds change.

The initial four tests passed at load 7.55 in 2.98 seconds. The new
walking/sprinting cases cover 12 delay/error combinations; the two
original single-tick cases stay green. Deck height is checked after
every fixed step and the newest-block reconciliation in each batch.
The floor accumulator matches the number of 60 Hz simulation steps
completed at each 60 ms drawn-frame boundary.

Review caught an initial test error: it reconciled every held packet,
which the real client discards. The sink now targets the newest block.
This fixture isolates delivery batching; it does not model the game
loop's per-frame fixed-step cap or its device top-ups.
The corrected four cases pass in 2.13 seconds, without changing any
deck limit, delay, injected error or gait.
