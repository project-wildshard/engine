# Ring 1 records the newly carried repair state

Ring 1 run 42446355725 on published 8278424 failed its strict step
comparison for Driftwood and Pine. Its cook and boot capture passed;
this is not a capture timeout. Six other step rows retained their hashes.

The actual 240-tick server-slice walk reproduces both differences.
The clean release checkout at 0d9e238 reproduces all old checkpoints.
Diagnostic copies of the current snapshots reproduce every old link
after removing only the added empty owned.harvest adapter and, in Pine,
the added zero statusStun attribute. There are no new native attack
targets at these checkpoints. No physics, pose, reward or decision
difference remains; none was masked in the production comparison.

The new four-link chains are recorded for only those two rows. The
existing Darwin and Linux chains were identical; Linux CI independently
reports the same new terminal prefixes cb95ce0b4a019305 and
b111b2d5e8789f86. The full chains here are measured on Darwin, with the
same explained state additions applied to both platform records. The
next strict Linux comparison remains CI's verification, not a claimed
local Linux run. All other rows and the comparison code stay unchanged.
