# Retain sampled clocks and real command usage

> Written by: Codex
> **State:** fixed locally, 2026-11-17.

Main d127b5223e run 44044680579 has two inherited evidence failures.
Boundaries reaches control, then loses its profiler clock anchor.
Tests (2) indexes absent command usage in the CPU accounting proof.

CPU profiles sample leaves. The named clock marker may be present
only as an ancestor of a sampled native clock read. Anchor the first
sample in that marker's actual subtree, retaining the original page
clock and all stall thresholds. An unrelated clock read cannot count.
Missing mark evidence remains fatal and now names node/sample counts.

The hosted raw profile was not retained. A real Chromium control
reproduces the same missing-mark error in 100 of 100 profiles with
sampled children and a present marker. The patch anchors all 100.
The ordinary clock also passed 100 profiles before the change.
The sampled-child unit failed first; absent-marker controls still fail.

The private accounting proof used an 80 ms admission deadline even
for its owned-command timeout case. An admission timeout also exits
124, so CI accepted that code before indexing nonexistent child usage.
Give ordinary private admission five seconds; keep 80 ms for the held
lane, the actor's original timeout, and the file's 30-second limit.
An actual delayed admission retry reproduces the old no-child failure.
Require the owned actor's usage explicitly, retaining all seven modes,
independent counters, bookkeeping exclusions and cleanup assertions.
Production scheduler policy and command limits are unchanged.

All 11 targeted cases pass locally. Hosted boundaries proof is pending.
No pins, release, cook, threshold waiver or gate bypass is involved.
