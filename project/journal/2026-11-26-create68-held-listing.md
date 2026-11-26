# QA 11-25 row 68r: the server's create waited on the page

> Written by: Claude (opus-create68), 2026-11-26.

Nalati's cold Linux prepare logged `server:simulation-and-collision-create`
at 50 to 85 s, and 14 to 29 s per `server:verified-input`. In Node the same
create takes 1.2 s (and 1.4 s under Bun's JavaScriptCore), so the time was
not the build of the world.

A full boot timeline from a local Linux repro (Playwright's WebKit in the
`playwright:v1.65.0-noble` container, 4 CPUs, the 4daadc70 preparation
client) split the 28.9 s create into 22.7 s waiting for the page to answer
held reads, about 1.3 s of the worker's own work, and network reads in
between. Each of the create's 63 reads first asked the page (DL25) over the
held-reads port, and the page answers only on its main thread. That thread
was drawing the software-GL first frame for 25 s, so every ask sat until
it finished. The page held none of the 63 files, so every wait ended in
"not mine". The installers also read the same file again (39 files in 63
reads; the sheep book 10 times), and each read asked, fetched and hashed
again.

The fix:

- After the descriptor names the server's files, one `listed` ask learns
  which of them the page's download lists (`spawnListed`, the same check
  `spawnHeldBytes` starts with). Only listed files ask the page for bytes.
  The rest go straight to the network. A page with no check, or a broken
  answer, lists everything, so it behaves as before. A file the page
  lists only after that answer (a later download job) is read from the
  network: the same bytes, verified the same way, read twice.
- `verified` reads a file once while a read of it runs, and keeps the
  verified bytes behind a WeakRef. Each caller still gets its own copy.

The guard is `test/standalone-held-listing.test.ts`. Nalati's create must
ask the page nothing, and the one listing must cover every file it reads.
A second read of a file while the first runs fetches nothing more.

The entry itself is bound by the page's own software-GL stages, not the
server. On engine main the create often finishes before the first frame
starts. Then it takes 3 s either way, and the entry is still 93 s
(first frame 27 to 34 s, spawn programs 13 to 17 s).
