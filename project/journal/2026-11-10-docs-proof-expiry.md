# Refuse stale docs-only scope after migration expiry

The real docs-only CI receipt compares a journal-only commit with the
last successful code-proving ancestor and retains lint, format, asks
and outgoing history checks. That optimization still needs current
test scope, not only identical source bytes.

Inherited lift tests return to blocking discovery at their immutable
policy deadline. A green predecessor before that deadline did not run
those files. Once a nonempty inherited inventory has expired, CI must
run full even for docs until that inventory has real dispositions.
This deliberately stays conservative; no date, exclusion or assertion
changes and no source parser is used to pretend a file executed.

The real Git/Actions-API classifier proof now adds an actually expired,
Git-bound policy and a restored file which genuinely fails on Node.
Old code incorrectly allows docs-only; the forward requires full.
Existing red/cancelled-code, prior-docs-only and unavailable-API
negatives remain, along with the existing no-policy positive.
