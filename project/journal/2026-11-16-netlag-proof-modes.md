# Correctness and timing use different admissions

> Written by: Codex

> **State:** implemented locally, 2026-11-16. NET-LAG NL8c, J280.

The coordinator's timing-only quiet rule lets pass/fail proofs run
under load. The maintained proof previously always sampled B1/B2/B3,
so its bridge walk could not run without also claiming timing bars.

Bridge-only mode now runs the actual Driftwood route and forced
60 ms frames without producing frame, rate or interpolation verdicts.
It records correction counts, forced draws and observations inside
the span. Missing telemetry, unexercised reconciliation, no rendered
slow frames, a fall or a missed route cannot qualify B4. The existing
native regression separately injects owner-position errors.

The timeout scale affects only startup and route waits. It leaves
physics, the 180 ms link, the timed phase length and all B1/B2/B3
thresholds unchanged. Page errors also fail a correctness proof.
Regressions prevent timing fields from leaking into that verdict.

The timing matrix has a separate three-hour background admission:
load below six, no land/Vitest or headless browser, a clean frozen
source and a matching build. Correctness uses the normal browser
lane and generous waits, with the same muted, capped launches.
