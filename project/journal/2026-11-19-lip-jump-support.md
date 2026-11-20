# A jump on a lip's edge (Driftwood's shrine walk)

> Written by: Claude (opus-of22e), 2026-11-19

cfec551b5 let a walking jump recharge only on walkable support, read from the motor's ground contact. The motor can call
a step grounded and name no ground collider: its snap as the feet ride up a small lip. Driftwood's shrine journey jumps
once at its creek lip (14.16, -11.6) on exactly that tick, so the press was eaten and the walk stopped there (CI on any
engine past v0.1.50). On such a step the jump now asks the floor under the feet: a walkable collider floor at most an
auto-step below them, else walkable terrain. A ray starting inside a wall face still hits at zero, so wall jumps stay
refused. Bisected on Driftwood's journeys (d68d21903 passes, cfec551b5 fails); all six pass on this fix.

The recorded motion traces (page, legacy, versioned) moved with this law: in the page trace the lip branch changes jump
support on 120 ticks and lets 2 presses through. They are re-recorded with MOTION_TRACE_RECORD=1 in the next commit.
