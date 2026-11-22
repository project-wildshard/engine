# Build-max C5: one push gate at a time under heavy load

buddy-engine, 2026-11-21, for the Coordinator.

The heavy lane scopes each push lease to its checkout, so every worktree
and engine-quickfix could gate at once. At a load of 25 to 37 each gate
ran slower than its tests' timeouts. My own C4 push today lost one gate
to a headless worker test killed at 20 s with the load at 26, and that
test passes alone.

`scripts/push-gate-slot.mjs` gives the machine one gate slot, a pid lock
in `~/.cache/wildshard/push-gate-slot.lock`. A dead holder's slot is
taken over. A gate takes the slot only while the 1-minute load average
is over 24, right after the exact-tree reuse check, so a reused proof
never waits. It holds the slot until its process exits. A waiting gate
looks again every 15 s. If the load falls under the line it starts
beside the holder. After 20 minutes it starts anyway and says so, so a
stuck holder can't stop every push on the machine.
