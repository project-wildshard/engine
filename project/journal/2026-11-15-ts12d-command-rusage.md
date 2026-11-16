# Separate command CPU from lease bookkeeping

> Written by: Codex
> **State:** built locally, 2026-11-15; HOW-WE-BUILD TS12d.

The full-test day log retains its schema and old lease totals. An additive
commandUsage record describes the directly owned child and descendants
that child reaped. Only full-test resources collect these fields; build
callers keep their existing path.

RUSAGE_CHILDREN counts children after they terminate and are waited for.
The new baseline is immediately before the sole owned-child wait, after
admission, lease publication and the kernel identity probe. The end read
is before any ticket/lease cleanup. A child already in zombie state still
has its unreused kernel identity and is not charged until wait reaps it.
The command wall is launch-to-reap, separate from queue and lease wall.

Admission, timeout, signals, cleanup and exit codes are unchanged. Failed
admission or launch has no invented command. Missing/reset counters stay
unavailable, not zero; missing identity cannot qualify a later join.

Seven real process controls compare child user/system clocks, include a
reaped busy descendant and add expensive helper children before and after
the command. Their CPU stays in the old lease totals and out of command
CPU. Nonzero/timeout/refused/failed-launch/unavailable cases retain their
original lifecycle. The original wrapper fails the new contract before
implementation. This is a command fixture, not ten full engine gates.

API semantics: https://docs.python.org/3.9/library/resource.html#resource.RUSAGE_CHILDREN
