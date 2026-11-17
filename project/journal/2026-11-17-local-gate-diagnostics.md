# Keep the real local-gate failure

J400: mmo1's complete gate passed (1390.3 seconds), but its push receipt
claimed an inherited CPU grant refusal. A native Git regression reproduces
that exact message: main moves during a green pre-push, the remote refuses
the stale push with a different porcelain reason, and an expected CPU error
printed by a passing negative control becomes the selected cause.

Read the final remote porcelain rejection before hook test output. A remote
rejection with an independently verified main advance rebases and gates the
new tree again, regardless of the remote's wording. A genuinely red hook
with a simultaneous main advance still stops. No CPU capability or ancestor
validation is relaxed. The original run did not retain its raw Git stdout,
so the reproduction establishes the failure mode rather than recovering
the missing original remote reason.

The second regression covers Vitest evidence: every full local gate writes
a unique JSON report under tmp/<lane>/, retains it, and prints assertion
and setup failure files to stderr where land shows them live. Missing or
unreadable reports explicitly name the expected path. JSON output remains
available for unhandled errors even when it names no failed test file.

Review follow-up: keep Git stdout and hook stderr separate when choosing
the stop message as well as when deciding whether main moved. An expected
sample porcelain trailer from a passing test cannot outrank a genuine red
hook. Its regression failed first. Green gates print the retained report
path without suggesting that successful tests need failure inspection.
