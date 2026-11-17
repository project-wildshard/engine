# Carry a verified full gate across a disjoint main delta

J400 FL5b: SB34 and SA25a each completed a green full local gate
and then repeated it after losing main. Rebase after a real green
hook, authenticate the earlier full receipt against this host's
current runtime, installed bytes, pins, exclusions and repository,
and compare both complete Git path sets and raw blob/mode diffs.

Only an unchanged branch diff with disjoint incoming main paths
can compose coverage. Run CSS, every static check and all tests
affected by incoming main under the real full-test lease. Missing,
partial, unsafe or mismatched receipts, overlap or changed branch
content retain the complete gate. Unknown graph coverage and
test/dependency harness changes also select the full suite.

After success, revalidate the earlier receipt and current checked
tree, then record complete coverage with its inherited run and
commit. Repeated races can build on that verified coverage. There
is no split filtering, known-red tolerance or patch-id-only carry.
The existing exact SHA, main-only ref and pin admission remain.

A native red control also exposed a text ambiguity: a failed hook
printing sample Git rejection lines was retried as a green race.
Local hooks now acknowledge zero exit through a private per-push
nonce, withheld from gate workers. A real red stops once even if
its test output resembles Git. The nonce is removed after Git
drains; failed or missing acknowledgment cannot authorize carry.

Native history/receipt controls failed first and cover disjoint
selection, partial/missing/unsafe receipts, altered branch content,
wrong HEAD, runtime mismatch, broad harness changes, lineage and
real-Git red/race behavior. Review found no MUST. Its split-mode
and nonce-isolation hardening findings are fixed. The main hold
for SB34/SA25a is respected while local validation completes.

Review hardening: an inherited receipt stays in the checkout and cannot seed
another reduced gate. Repeated races retain the original direct full basis
and test the cumulative incoming main delta. Incoming docs
still run agent parity. Regenerated branch stamps deliberately force the
complete gate when their blob delta differs from the tested feature.
