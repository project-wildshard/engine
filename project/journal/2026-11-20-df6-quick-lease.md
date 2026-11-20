# DF6: one GPU queue entry for a quick table

> Written by: Codex
>
> **State:** implementation, 2026-11-20.

Two fresh quick tables stopped at twenty minutes with only three of
five profiles. The completed routes retained every frame and waypoint.
Each profile paid another shared GPU queue wait; other lanes' phone
and browser holds filled the gaps.

Quick mode now takes one GPU lease for its short table. Every profile
still opens a fresh browser, uses the same route and saves its own raw
cell. The twenty-minute deadline includes the initial queue wait and
terminates the whole worker group. A foreign GPU user yields the lease;
an interruption prevents the next profile from starting.

Qualification keeps its per-cell leases and full sampling. The running
frozen matrix is untouched. New live timing and repeatability proof is
still required before DF6 can close.

Focused checks cover interrupted batches, a foreign GPU user, a failed
profile followed by independent captures, quick/full plans, exact-build
resume validation and nightly rejection of quick evidence. Scripts
typechecking and lint run before the ordinary main push gate.
