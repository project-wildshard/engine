# Preserve a completed capture handoff

Queue 133 finished capturing and returned its queued record, but the
worker had already read the earlier capturing state. Its later real
flock probe correctly saw no capture owner; using that stale record
then incorrectly failed the completed job and removed its snapshot.
No source check or publication was attempted.

Reread the authoritative atomic record after observing a free or
unverifiable capture lock. Refuse only a record that is still capturing.
A completed handoff returns to ordinary drain and all normal snapshot,
hook and publication checks. An actually abandoned capture still fails;
PID reuse is not used as lock ownership.

The real Git/CLI handoff proof schedules the lock probe after a real
capture has published queued and released its actual flock. The old
worker falsely fails, the new worker runs its unchanged normal hooks
and publishes the checked commit. No production timing control or
bypass is added. Existing abandoned-capture and remote-race proofs stay.

J206 found no MUST-FIX. Both cleanup/dependency-resolution SHOULDs
are fixed: failure teardown releases the fixture probe and waits for
the real worker flock to drain; copied drivers keep the invoking
installation when the caller chooses an external fixture directory.
The forced interruption observes the old holder-only cleanup leaving
the worker held, then proves normal teardown frees it before removal.
