# Retire a quest book when its body leaves

The pinned Driftwood MS9 replay lost its second worker seat before the
signed restart. The worker reported a missing cable seat after the same
guest quit to checkpoint and returned quickly. Its quest book still
held the old body's continuation. The cable update discarded that
body's seat while the reused book reached for it on the next save.

Remove the book with the body. A returning guest gets fresh quest owners
and imports the saved state into them. Rebinding retires the previous
chapter scope even if the absence fell between ticks. The regression
quits and restores the same player ID before another simulation tick,
then steps the host and reads the persisted cable state.
