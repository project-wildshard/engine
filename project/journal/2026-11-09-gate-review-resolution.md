# Resolve the gate-integrity review before publication

The clean publication view carries only the three required gate fixes
and their type/review forwards atop upstream1d3b37e (kit planner fix).
The prior7490d38 was exact-green; the final combined tree still needs CI.
It excludes the
optional four-slot cook experiment and other lanes' held source.

J206 one-shot review used codex exec, gpt-6.1-sol, read-only sandbox and
ephemeral mode, with every HERDR-prefixed environment key removed.
OpenUsage's default Claude account reports100% with a future reset, so
the permitted Codex fallback was used; no account/auth switch or unsafe
older review command ran. The reviewer read source/Git only and wrote
its report outside the checkout. No review-caused source write occurred.

The reviewed684176e closes worker bypass inheritance and actual ref-tree
mismatch. The review's further MUST-FIX is reproduced: a real final Git
metadata read starts before expiry and finishes after it. Both a cache
read and write incorrectly accept the old scope. The ordinary policy
reader now decides expiry after validation, while explicit observations
retain their supplied time. Both real-clock boundary cases pass2.6s.

The empty-ref SHOULD is also reproduced on an actual up-to-date Git push
and fixed. The remaining SHOULD is disclosed: the lease-race fixture uses
the real entry/capture with a complete tiny gate; it does not negatively
exercise the production whole-suite post-gate guard. No extra proof claim
is inferred from that fixture. There is no second review round (J206).

All eight focused protocols pass against this frozen installed source:
worker environment, actual ref/lease race, timed scope, compiler inputs,
cache coverage/negatives, two leases, partial source and queue FIFO.
Every original tree/compiler/dirty/scope/CI refusal remains. Full layered
types and targeted typed lint pass. Actual quarantine/lift inventory,
registration, deadline and extension bytes are unchanged.

Official source recomputation gives renderer
596de22c355620999f1c24ad8fa7b7ab7c5d72cb99f902a881f41d6479e3a7d1;
admission is02bbb58af0931acf4468391a8002808234c25210b864cf6e4b5c3f7f4aceb8e1.
The normal immutable full hook and exact hosted CI/Ring1 are still
required; neither review nor focused fixtures substitutes for them.

Final acceptance also checks the live deadline after receipt coverage and
receipt I/O; an expired new receipt is removed before refusal. After the
required rebase, the real environment/ref/expiry protocols pass again
(2.18s ref race, 3.44s expiry/set/deadline, 2.29s each Git boundary).
Full/Ring1 planners retain every gate: 12 shards238.120s, 8 shards221.578s.
The measured upstream kit-module fix is retained, never duplicated.
