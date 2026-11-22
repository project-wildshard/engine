# Keep release observers still while armed

The v0.1.69 signed staging switch advanced both native bots from save
1 to 25 and kept their coins and ledger. One progress hash changed.
Both bots kept sending movement commands between the checkpoint capture
and the restart. Walking during that wait can change the progress the
observer is trying to compare.

After the baseline movement and checkpoint checks, keep both sockets
open and send neutral input. Start moving again on redial so the report
still measures the return to control. The signed local restart verifies
the two neutral inputs before the baseline is reported and both durable
restores after the restart. The hash comparison still treats new progress
as inconclusive and detects older or reduced saves.

The cancellation test timed out on the unchanged main when the MacBook
missed a file-watch event. Its child had written the ready file. Wait for
the file itself within the existing timeout so the test reaches the
process and store-marker cleanup assertions.
