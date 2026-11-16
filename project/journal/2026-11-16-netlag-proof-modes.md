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
slow frames, a fall or a missed route cannot qualify B4.

Review caught a vacuous dependency on natural corrections. The proof
now reads the actual client and predictor via a developer-only
accessor, removed with the page's scope. The online shell refuses a
second bot; that failed attempt is retained, and no bot is created.

The first four-way bridge matrix crossed in every variant with no
fall or sampled feet under the existing threshold, but confirmed no
injection and correctly failed B4. Live input reconciles within an
earlier frame listener, before a later observer can replace latest.
The proof now wraps the actual predictor reconcile call, lowering a
copied owner argument by 0.3 m outbound and 1 m returning. Neither
latest nor saved wire frames change. Each injection counts only when
the real correction observer confirms that exact tick. Serialized
regressions cover synchronous live delivery and newest-only render
delivery, copy isolation, confirmation and restoration of the method.

The timeout scale affects only startup and route waits. It leaves
physics, the 180 ms link, the timed phase length and all B1/B2/B3
thresholds unchanged. Page errors also fail a correctness proof.
Regressions prevent timing fields from leaking into that verdict.

The timing matrix has a separate three-hour background admission:
load below six, no land/Vitest or headless browser, a clean frozen
source and a matching build. Correctness uses the normal browser
lane and generous waits, with the same muted, capped launches.
