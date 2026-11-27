# Keep main-push on the checked update

Main-push selects the update while it holds the lock, then gives the
same base and tip to its early gate and its push. The gate certificate
records the exact pair. Commits added to local main during the gate
stay local.

If origin advances, main-push replays the original selection and runs
the normal gate for the new update. A regression adds a commit during
the early gate. Another advances the remote during the gate and checks
that the replay carries only the original change.

The pin fixture clears the hosted CI flags in its simulated local
push. Both FS18 regressions pass with the flags set in the parent.
