# Shard Select keeps its last layout offline (OFFLINE OF20)

A released page learns the cells the API placed after its build from
the signed placement file, read `no-store` with a 3 s deadline, and
kept nowhere. Offline, or on a link that hangs, Shard Select fell
back to the build's 25 cells: a placed Open Plot the player saw
online was gone.

The device now keeps the last file it believed, in OF0's
`gridRoute` slot beside the world's kept word (one store, as the row
asks; each writer keeps the other's half). The next page checks its
signature again and installs it before the fetch, so a hung read
still leaves it in place when the entry's deadline fires. A fresh
file read in time replaces it, built from the build's own catalogue;
a 404 drops it, and so does a kept file the key no longer believes.
A shard carded from the API's catalogue (SA46) stays out offline:
its card and content are network reads too.

The unit test compares the offline layout (cells, cards, the one way
in's cell, the assembly's instances) with the online one. The
`offline-proof.mjs` half of the done-when (an offline Shard Select
entry with zero network reads for the layout) is left for OF18's
release-train run.
