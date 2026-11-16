# Qualify the observer through actual producer records

> Written by: Codex
> **State:** built locally, 2026-11-16; HOW-WE-BUILD TS12e2.

Observe accepts --proof-root (one receipt or a bounded directory) and
--command-log. With neither, its existing sampled/unverified behavior is
unchanged. Requested qualification requires both inputs, retains the raw
report and publishes command CPU only after the owner-bound join passes.
Otherwise it saves an explicitly unqualified observation and exits 2.
Qualified proof and command keys are retained to prevent dataset replay.

The parent can publish its release after the selected command drains.
The observer waits only inside the existing drain budget, and reparses
when the log size changes. It never signals or changes the gate.
Qualification CPU/wall is reported separately from the recorder's CPU.

Live CLI fixtures exposed a known PID disappearing during inventory and
being confirmed gone on a later sample. The old historical miss counters
remain intact; unresolved identity reads are now recorded separately.
Only a complete final observed drain can qualify. Historical read gaps
remain visible and never supply the independent reaped-command CPU.
Missing root/producer identities, unresolved identities, truncated files
and orphan writers still refuse.

Fresh full scope and an intentionally delayed release qualify. Actual
docs, related, split, reused, failed and missing-input paths stay unqualified.
A detached writer remains alive after observer refusal and finishes on
its own release marker; its raw report survives. The original CLI rejects
the new options before implementation. These are complete fixture gates,
not nine engine full suites or ten real full-gate census observations.
