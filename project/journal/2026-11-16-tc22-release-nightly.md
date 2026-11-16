# Release checks read the nightly

> Written by: Codex

> **State:** built, 2026-11-16; TEST-COVERAGE TC22 (J370).

The optional nightly tag helper already requires full green, but the
actual release helper calls release-check.mjs without that nightly read.
The real release entry now downloads the latest completed scheduled main verdict
and refuses newFailures before either cached or fresh local checks.
Run/source identity and artifact failures close the gate too.

The lean row deliberately leaves J167's any-red check manual until the
first full green night. Existing failures passing this new check are
therefore not release qualification. No staging or release is performed
on the mini. An explicit planted-failure proof exercises the real entry
and stays report-only in hosted CI during its first real week. Admission
review is no earlier than 2026-11-23 and requires an explicit decision.

The J206 read-only Opus review found that a manual staging dispatch could
replace production evidence. Selection now filters event=schedule and
validates that event; a manual run is a refusal control. The fresh-gate
test explicitly disables local cache use, while the separate cache proof
checks actual cached-full refusal and reuse.
