# Keep full-gate files within six CPU slots

> Written by: Codex
> State: HOW-WE-BUILD EV7a, 2026-11-17.

The full gate starts six Vitest workers. Its broker admits numeric
requests against a combined six-slot limit before submitting them to
the machine scheduler. Waiting files keep spare machine slots free for
peers. A whole-machine timing test waits for the cohort to drain, then
receives its original exclusive grant.

The two real cook suites receive two slots. The limits suite runs no
cook and uses ordinary admission. The owned socket fixture checks the
cohort cap, a peer's spare slots, exclusive admission and cleanup. Wall
time and CPU readings come from five ordinary full gates under EV7b.
