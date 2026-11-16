# Main must not demand a newer client than itself

ea264dc0 raised minClient to 0.1.31 while main still calls itself 0.1.29.
That makes the real boot updater wipe/reload its own newly built page.
Clamp the policy floor to the current build's package version. Release31
and later still emit minClient0.1.31; old-numbered main builds admit
themselves. The regression feeds actual generated metadata into the
real ClientUpdater boot and foreground path, including main0.1.29.

The active release retains explicit floor31 metadata before normal
service-worker/output checks. No cache wipe or preservation rule changes.
