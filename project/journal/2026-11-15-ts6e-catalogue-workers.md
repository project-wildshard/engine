# Share the read-only catalogue suites

The grid-layout, grid-format and nightly-plan suites only inspect owned
catalogue data or clone their mutation inputs. Reusing a worker avoids
loading their common setup graph for every file.

At main db15eef42a all twelve cases passed alone, isolated together and
in both reversed shared orders. A warm isolated run used 1.946 CPU-s;
the shared runs used 1.704 and 1.750 CPU-s. These are batch measurements,
not a claimed saving for the full gate. Meta keeps the exact config,
orders and source hashes in SHARED-NEXT-20261115.json.

The held wire-stability branch remains at 82bdf08c. Its clean, idle
checkout was reused for plan/build-speed-next without deleting the
held commits or adding a worktree over the live-tree cap.
