# Driftwood worker receipt spacing

> Written by: Codex
>
> **State:** 2026-11-20. DF12 route measurement.

The standalone worker sends snapshots at 30 Hz from its 60 Hz simulation.
Compare each pair of increasing snapshot ticks against the interval measured
at receipt. The clock already takes that timestamp ahead of message decode.
The route reports the spacing error p95 and maximum over packets.

The interpolation clock also records the difference between the arriving
tick and its projected server tick. On Driftwood, synchronous saves delayed
worker wake-ups past the catch-up cap. The phase error persists while the
interpolation clock recovers from the discarded simulation time.
The route keeps the phase reading next to interpolation delay, with the
spacing measurements in their own column.
