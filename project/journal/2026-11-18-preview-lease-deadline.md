# Preview lease fixture deadline

> Written by: Codex
>
> **State:** verified 2026-11-18. Main-watch M2.

The preview lease fixture stopped its launcher after 20 seconds. The
launcher itself allows 30 seconds after the stubbed build to establish
ownership and answer HTTP. A 21-second delay before the readiness probe
reproduces the report on the Mac mini. Allow the launcher to finish its
readiness check and report its own error. If the outer fixture still
times out, include the launcher's partial stderr.

The later full local gate stopped all three partition processes at their
45-second aggregate cap. The launcher and Python fixture were unchanged
since the first fix. Each partition can run four sequential 35-second
launcher checks plus shorter admission and teardown checks. The outer
runner now allows that envelope, observes cancellation, and includes the
named Python fixture and its output when something fails. Production
readiness and every existing fixture assertion retain their deadlines.

All 36 Python cases and three normal Vitest partitions passed. A scratch
launcher with 14 seconds of delay at each startup passed partition one
in 63.14 seconds. Every individual launch still used its original limit.

The next peer full gate could now report the individual failures. It
finished the stub builds and hit the launcher's 30-second readiness
deadline on both assigned ports and port zero. The test's substitute
Python HTTP process produced no startup output. A separate full gate
and a focused clean gate copy both passed the same source, so a short
run alone could provide little evidence about the peer failure.

The fixtures now use the shipped preview server, including its actual
HTTP listener and ephemeral-port announcement. The Node shim records
the child PID for cleanup and hands off to that server. The builds are
still stubbed, and the real detach, ownership, conflict and sharing
checks run with the original launcher deadlines.
