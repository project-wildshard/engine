# Restart the scratch database during a save

MMO-SERVER E7.4b.c. The first two-bot run proved that the replica
survived a PostgreSQL restart. Its fixed timer did not establish that
a save write was in flight.

The allowlisted helper's checkpoint option waits for a replica
`player_save` write to block on a table lock held by the probe. It
keeps the transaction open until it restarts the scratch cluster.
Without a witnessed write it exits before the restart. The bot driver
requires the helper's witness and keeps its timestamp in the report.

A disposable Debian PostgreSQL 16.16 instance started with one
committed save, then observed one blocked insert at restart. The
2.417 s restart preserved the committed save, and the next write
landed. The signed helper still needs to run with two bots on the box
to verify their positions and save latency.

The driver keeps reading bot output while the restart command runs.
It waits for the helper's result before writing the report.
