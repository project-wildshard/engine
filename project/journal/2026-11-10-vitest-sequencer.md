# VITEST-BENCH VB8: the cook worker no longer runs last

Jake, 2026-11-10: "cap vitest at 6 cores and benchmaxx it, and fix the
long tail". Plan: meta `docs/plans/VITEST-BENCH-PLAN.md`, row VB8.

The push sequencer already ran files longest first, but it pinned two files
to the very end: `net-bots` (an all-slot timing proof) and `cook-worker`.
The cook worker used to ask for the whole machine too; since f8f8503 it holds
a bounded 4-slot grant, yet it kept its last place. Every recent queue gate
shows the result: `cook-worker` (26–34 s) and then `net-bots` (8–12 s) are
the last two files to finish, on about one core.

The other all-slot file, `cook-cpu-limit`, sat by its weight near file 125.
The CPU broker is strict FIFO, so an all-slot request queued mid-run makes
every later file wait until the longest running file ends.

Now the cook worker is ordered by its own weight (the heaviest recorded, so it
starts first), and both all-slot files start last, where they wait only for
the short files still in flight. The list of all-slot files is one constant
shared by the sequencer and the CPU setup file.

A small strict-FIFO gate simulator, fed the real per-file times of the last
two green queue gates, puts the change at about 20 s of wall at 10 workers
(221 → 199 s and 233 → 209 s simulated, against 207 s and 224 s real).
At 6 workers the same work simulates to about 310 s, so the worker cut waits
for the rewrites that shrink the work itself.
