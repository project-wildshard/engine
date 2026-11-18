# Reduce dedicated entry test setup

The six cases in dedicated-zone-enter.test.ts took 67.673 seconds
against 60 seconds in main run 44212779772. Reuse the verified
product inputs for each shard within the file. Every case still
starts a new door, worker worlds and sockets. Start each approach
one metre before the boundary it crosses under real input.

Locally the sum of the six case times fell from 28.694 to 19.466
seconds. All six passed, as did the nearby Far Reach road proof
on both runs. Comparison retained all 59 assertion, case, wait
and deadline lines.
