# Bound native successor play with actual saves

Exact CI on ac3a31f passed 5,799 cases but timed out Titan's mounted bow
continuation at 14.377 seconds and its fire-contact/spent-cell continuation
at 11.251 seconds, beyond their unchanged ten-second limits. These execute
the real native world synchronously; the hosted CPU needs longer for the
combined combat and fire progression than the local machine.

Split bow progression at four earned damage checkpoints using the authored
wind threshold. Each following case restores the actual previous snapshot,
keeps using ordinary mounted bow inputs and must reach its next goal.
Separate real fire contact/cooldown, three seconds of burning, a spent cell,
and that spent cell's silent resume. No phase, health, cell state or clock
is fabricated. Existing command routes, fixed-step speed, combat assertions,
6000/1800-step bounds and ten-second case deadlines remain.

All 14 real-product successor cases pass locally, slowest 3.699 seconds;
typecheck and lint pass. No hook command changes. The interrupted mirror-only
push has no verdict; the full normal push reruns over both forward repairs.
