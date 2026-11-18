# Split Metal passes under the loading card

> Written by: Claude (mini-shadermem), 2026-11-18. MEMORY-GATES MG9/MG11.

No shader compiles after control on Template, Pine, Driftwood, Nalati or Nine (GL link, first draw and pipeline-key
recorder; Metal System Trace compile intervals of our GPU process). Driftwood's ~70 MB that WebKit frees 10.5 s after
the last Metal compile is the tiler parameter buffer (MG10, `57fbb300`), sized by the boot's heaviest pass: deleting
every GL object frees none of it, skipping the zone's heavy draws keeps it at 17 MB.

`installPassSplit` takes a loading limit; `Loading` (not an inset card) holds it while alive, so boot passes split at
400 k vertex invocations and play frames do not. 6 alternating cold WebKit runs: Driftwood settled GPU 501 -> 446 MB,
EM11 playing upper 1.124 -> 1.057; Nalati 456 -> 417, 1.127 -> 1.092 (loading upper 1.539 -> 1.498); Pine 474 -> 463;
Template flat. Detail: meta `docs/plans/engine-memory/shader-compile-2026-11-18.md`.
