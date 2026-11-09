# Do not spend the hook's wait behind a manual suite

Queue43 and44 capture c5f07e0 and fail before tests: their five-minute normal
hook acquisition expires behind j189's real global full-test owner74151.
That owner has run575 and904seconds respectively when the failures occur.
These are admission failures, not another source assertion regression.

The queue records waiting-for-hook and waits outside the hook for conflicting
real full-test flocks and global FIFO predecessors. This wait is bounded at
100minutes, separate from test timing. The unchanged pre-push then acquires
its actual authenticated lease and runs every check. No result is reused,
created, or uploaded from waiting. Preserve the scheduler's base root while
still removing inherited tokens/views; the real hook supplies its own view.

The outside-hook proof holds a real global lease, verifies a short wait refuses
without starting work, observes another waiter remain blocked, releases the
owner, and runs its normal guarded command. Original queue refusal/race proofs
remain required. Existing source red hooks never retry merely because of this.
