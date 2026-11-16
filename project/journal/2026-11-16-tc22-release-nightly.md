# Release checks read the nightly

> Written by: Codex

> **State:** built, 2026-11-16; TEST-COVERAGE TC22 (J370).

The optional nightly tag helper already requires full green. The legacy
release-check entry now downloads the latest scheduled main verdict
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

Reading current repo-kit main90b84cb's release-branch.mjs revealed that
its finish path no longer calls release-check at all. The initial land
waiter was stopped before landing. Engine's actual pre-push now reads
version tag updates through the same nightly guard before the full gate.
A real Git push to a test-owned bare origin proves a planted failure
leaves no tag and never reaches the full check. Ordinary pushes do not
read the nightly. No shared repo-kit source or release operation changes.
# Follow-up review: keep the soak outside wall accounting

TC39's independent J206 review caught TC22's report-only step before
the packed share's wall verdict. Its time could therefore fail the
blocking share despite continue-on-error. Move it after that verdict
and bound the explicit tests to ten seconds. No admission change.
The exact branch CI and actual cook receipts must be repeated.

The next rebase retains main's MF4 pin-provenance hook alongside the
actual tag's nightly gate. Its isolated tag fixture supplies the new
unrelated pin-check stub; the production check is unchanged. Both
release cases pass again in1.47s with format0.11. The old84cd CI's sole
red was J383's inherited no-cache expectation, already corrected on
main2f7b035d. Its actual release2/2 and reader8/8 logs are retained as
baseline. Normal land's automatic TS10 retry was stopped/cancelled
because this was a deterministic contract failure, not a flake.
