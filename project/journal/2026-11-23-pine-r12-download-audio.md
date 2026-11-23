# Check recordings and audio banks in their own transports

Pine r12 mounts its music and sound effect JSON alongside the recordings.
The cook includes the recordings in both DOWNLOAD manifests and folds the
JSON into the common boot table that LOAD reads. The previous test counted
the two JSON sources as downloads. The exact r12 pin reproduced that
failure. Assert each mounted metadata bank exists in the boot table and
retain the existing exact recording, missing, extra and duplicate checks.
All seven cases passed on the exact r12 pin.
