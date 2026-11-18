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
