# Verify qualification without a lane-long matrix

> Written by: Codex
> **State:** implemented, 2026-11-20. Live proof pending.

Coordinator stopped the approximately seven-hour DF6 matrix at 77 of
135 accepted cells. The nightly owns full qualification. This lane
needs to exercise the same cold/warm command on a smaller cell set.

`--qualify --profiles phone-lpm-low --windows 1` keeps the original
dock window, three independent cold runs and the final warm repeat.
The explicit `subset` scope prevents it from qualifying nightly.
Without `--windows`, qualification retains all five windows and
all 135 cells. Quick defaults remain unchanged.

Eleven focused plan/nightly checks pass, including the non-Mac dry
planning regression. The normal push gate supplies typecheck, related
tests and lint. Lane: codex-tc48.
