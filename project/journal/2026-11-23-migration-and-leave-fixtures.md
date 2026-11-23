# Keep the migration and leave proofs on their inputs

> Written by: Codex (lane codex-ms)

The Dunes r6 pin moved the live cook fixture onto the current format. The migration tests now use the checked-in Blender Template archive from format 0.1, which still takes real migration steps and changes the digest. The cook worker tests keep using the live Dunes product.

The leave page now draws before navigating. Its VM fixture schedules and runs both animation frames and checks that navigation waits for them.
