# Wait for the selected command's reap

> Written by: Codex
> **State:** built locally, 2026-11-16; HOW-WE-BUILD TS12h.

The batch review found a Linux-only race. Linux can read a zombie root's
identity before its parent reaps it. Calling that state drained lets the
census finish before command rusage exists, so the strict lifetime join
refuses a valid gate. Darwin retains that same interval as an unreadable
identity instead. Keep observing the selected identity until it leaves
the process table. Existing observation and drain deadlines still bound
the work; an unreaped root cannot produce a green completed census.

The control starts a real owned child, records its actual CPU baseline,
then leaves it unreaped across three observed zombie samples. Linux uses
its normal readable zombie; Darwin exposes the same identity from the
known unreaped child only after ps confirms state Z. The parent then
reaps it normally. The control fails the old recorder because it ends on
the first zombie sample. The revised recorder drains only after reap.

The same review's small follow-ups are included: newborn discovery waits
between inventory retries; both proof CLIs resolve relative scratch
paths; the displayed qualification states the reaped-descendant scope
and that short-lived or pre-attach orphans may escape observation. Darwin
pre-reap identity misses stay counted: unreadable identity is still an
actual read miss, and silently guessing zombie state would weaken the
report. The proof-pair preflight, unrelated proof-directory entries and
incremental publication-tail parsing remain named plan follow-ups.
