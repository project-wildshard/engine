# OF23g body clock

A same-frame body query can use the clock's first decision while the rate
stays the same. A new active wake after a zero step still goes through the
clock. The roster predicate needs one sample during a synchronous query.

The one-CPU Linux A/B/B/A median was 28.015 s on engine v0.1.62 and
25.975 s with both changes. Every story completed the same 33,090 ticks
and 72 segments. The recorded story receipts matched. A separate test
compared 480 continuation snapshots across 5,760 clock reads, including
restores, rate changes and active wakes.

The old and new endpoints already contain the duplicate roster query.
The change improves the measured workload. OF23g still needs hosted
evidence before Pine's existing 45-second deadline moves to 30 seconds.
