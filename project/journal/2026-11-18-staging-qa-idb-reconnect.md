# SQ19 own the Simulator touch companion

The shared `idb` device registry kept pointing at a missing socket after
the proof erased its Simulator. Retrying the tap asked the same stale
registry entry each time. The Safari proof now starts one companion for
its device and sends input through a socket in an owned directory. A
failed input retires that companion and retries through a fresh socket.

The socket regression test drops the first connection and verifies cleanup.
On staging v0.1.45 a native iOS Safari run deliberately stopped its owned
companion between calibration and the swipe. The recovered touch moved
the server-side player 8.85 metres. The proof shut down its companion and
Simulator. A separate loopback run delivered touch input but had no room
seat to measure against.
