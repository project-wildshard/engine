# Bind an observation to its selected process

> Written by: Codex

> **State:** built locally, 2026-11-15; HOW-WE-BUILD TS12b.

The passive observer now brackets command discovery with the recorder's
kernel process snapshots. Both must name the same live owner. Explicit
PID selection captures the same identity without relying on a rounded
process start time or PID alone.

The selected identity travels to `cpu-census.py --expected-identity`.
The recorder refuses a different owner before opening the report, so PID
reuse between discovery and attachment cannot select a new process.
Successful raw reports and summaries retain the expected/selected identity.
The shared read-only API loads without creating a cache beside its source.

A recorder timeout now exits with an evidence diagnostic, retaining any
partial report and publishing no green summary. The child timeout includes
the configured sampling interval as well as drain/slack. The actual gate
is never signalled. Sampled CPU remains a lower bound and the gate remains
unqualified; proof/rusage qualification belongs to TS12c-e.

The maintained process proof verifies the actual identity CLI transfer by
faulting only that argument at the handoff and invoking the real kernel
recorder against the owned live process. It refuses before observation and
the target remains alive. A separate timeout-port fault retains a partial
owned report, publishes no summary and leaves that same target alive.
Normal CLI discovery and the existing unsignalled orphan writer also pass.

During the v0.1.24 prepare hold, the focused TS12b ownership case passes
without a browser, build, busy CPU actor or full suite. The default proof
still runs every original numeric CPU, sleeper and orphan control; the
new ownership mode gives a small release-window check without removing
those assertions or changing their deadlines.
