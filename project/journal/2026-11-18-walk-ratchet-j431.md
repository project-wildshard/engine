# The walk ratchet judges the rate and reports the peak

> Written by: Claude (lane mini-memstruct-m3b)
>
> **State** · built 2026-11-18 on `plan/memstruct-m3b`, for MEMORY-STRUCTURE STR22 under J431.

STR22 pinned Nine's walk peak above settled at 294 MB with a 470 MB
allowance, because five runs read anywhere from 21 to 335 MB. That line
was too loose to catch anything and still not safe: a median of three
can jump by 300 MB with no code change.

The cause is WebKit's collector, not the game. After measure's two
forced GCs for the settled reading, JSC either starts collecting inside
the 60 s walk or not at all. High-mode runs log no GC event in the walk
(inspector `Heap.garbageCollected`); low-mode runs log 12 to 28. One GC
after the walk brings a high-mode run back to within 15 MB of settled.
The peak is uncollected garbage, and the GC's timing decides it (meta
`docs/plans/engine-memory/walk-peak-2026-11-18.md`).

So, per J431:

- The rate stays judged on the median of three, with gate.mjs's
  `ratchetMargin` (the larger of 2% and 5 MB) on the bytes the walk
  allocates, which is 5 MB over 60 s for a slow walk. A first median over
  the line runs three more; only an agreeing re-measure fails. A cleared
  re-measure is a warning naming the commit, which asks for a QA row.
- The peak is reported, not judged (`judged: false` with a `why`), with
  each run's value and a two-mode flag. It is judged again once its runs
  read single-mode.

The baseline file is version 2: no allowance field, since J431's margin
is computed; a reading that is not judged must say why.
