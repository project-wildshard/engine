# DF6: resume valid route measurements

> Written by: Codex
>
> **State:** cold roads proved; full matrix remains open, 2026-11-20.

The frozen matrix stopped progressing at 38 of 135 cells. Its separate
road diagnostic reached every quest-fire waypoint but recorded a stuck
sample in the first second of a reversal. An unmeasured approach now
sets its heading before moving. Measured legs keep the same turn rate,
waypoints, grading and stuck/skipped/lost-frame assertions.

The regression tests execute the serialized page helper: an approach
reverses and completes, measured walking retains its four-radian turn
rate, and a blocked approach still fails and releases held movement.
The focused route, matrix and verdict checks pass 21 tests.

The original matrix and runner remain unchanged. A separate frozen
continuation changes approach steering, lock queuing and ring drainage. Its
migration manifest names both methods, preserves all original files and
hashes the 38 imported accepted reports. No incomplete cell is imported.
The exact client/server build remains 39542d31dac.

The first cold road diagnostic clears every approach and all measured
waypoints, including the dwell and return. It correctly rejects 54 lost
raw intervals: a native burst filled more than the 120-frame ring during
the 150 ms sampling interval. Drain at half capacity as well as at the
normal sampling interval. Regression tests retain every interval at
1,000 fps and still reject frames lost between callbacks.

The recheck retains all 16,691 road intervals with zero ring loss and
all five waypoints, dwell and return complete. Compensated duration
summation keeps its 40 seconds from becoming 39.99999999999999 during
addition. A 10 ns real shortfall still fails the new regression test.
Regrading the unchanged raw intervals yields a valid desktop floor miss
(max 100 ms, two spikes); no threshold or assertion changes.

The restarted matrix also records the previously failing phone-High
road cell 2-1-5, moving from 38 to 39 of 135 accepted cells.

The table also joins the blocking kernel lock queue immediately. Its
previous idle-GPU wait and 30-second lease retries repeatedly lost its
place behind active lanes. The existing worker GPU guard still runs
after acquisition, and interruption still cancels the queued lease.

The prerequisite scripts type repair is pushed as 6e479a4f. The ordinary
push gate owns integrated types, lint and related tests for this change.

Lane: codex-tc48. DF6 remains open for its complete matrix, independent
repeat, current-main proof and 20-minute criterion. The serial fixed
sample windows alone require 120 minutes for the full default matrix.
