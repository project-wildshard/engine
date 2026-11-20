# Measure and resume individual Driftwood legs

The FPS table now takes one profile, route segment and repeat through
the GPU guard and shared measurement lock. Missing cells wait their turn.
A rerun reads exact-build results from its resume directory and only
retries cells that lack complete evidence.

Each segment starts from control and uses the driver's normal walking
inputs to reach the previous waypoint. Cold and warm measurements use
their own ordered leg samples. The table still feeds the nightly grader
with the same full-route report shape. Route samples retain the CPU
costs and add sparse Metal timer queries for calibration.
