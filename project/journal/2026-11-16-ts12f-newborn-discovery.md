# Retry a newly born gate within the same deadline

> Written by: Codex
> **State:** built locally, 2026-11-16; HOW-WE-BUILD TS12f.

If a real gate starts after the first kernel snapshot but before ps, the
observer now takes another bounded discovery iteration. It still needs
matching before/after kernel identities before attaching. An expired
deadline refuses immediately instead of extending the wait.

The regression starts actual Node owners inside that precise handoff,
then runs the real ps inventory and kernel backend. The old implementation
refuses a live new owner. The fix discovers it on the second inventory;
the zero-wait case refuses after one inventory and never signals it.
Existing ambiguous/missing/reused owner, timeout and orphan facts remain.

The removed default TS12b wrapper asserted discovery and orphan results
already asserted by TS12a, whose CLI executes those same ownership faults.
No proof assertion or deadline is removed. The light manual entry remains:
python3 scripts/vitest-bench-observe-proof.py --case ownership --scratch tmp/YOUR-LANE
