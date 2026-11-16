> Written by: Codex
> State: provider reclaim built and qualified locally, 2026-11-16.

The old CPU ledger removes a dead provider immediately. An app-build
command can outlive that provider, so its reservation must outlive it.
Opt-in command rows retain capacity until their authenticated private
group stops. Advance TERM and the existing three-second KILL escalation
without waiting under the scheduler lock. Remember group members before
TERM so a stopped root cannot hide a resistant descendant.

Birth identity and UID precede signals; uncertain/reused identity keeps
the reservation. Complete kernel inventory can prove a group contains
only stopped zombies, which may await init on Linux. Release of another
row cannot discard an owned command. Publication requires the actual
live provider and caller and an active immutable grant.

Actual provider loss, caller loss, removed checkout and premature release
all keep exclusive work blocked through an ignored-TERM descendant.
Forged evidence never signals unrelated work. Nine publication controls,
six reclaim controls, 36 ancestor controls and the unchanged direct and
broker proofs pass. Lint/types pass. App-build adoption is still pending;
the next unit retains this lifetime when borrowing an ancestor budget.
