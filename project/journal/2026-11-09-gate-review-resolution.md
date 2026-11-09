# Resolve the gate-integrity review before publication

The clean publication view carries only the three required gate fixes
and their type/review forwards atop exact-green7490d38. It excludes the
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
f75d717f13f450ea7ca87c8cc0521b1779d314571fcd0537276b3406618a98d4;
admission remains555d2c9b68f9f83bfe48983e3118e39820b65575e5459f46b6beba1662d11482.
The normal immutable full hook and exact hosted CI/Ring1 are still
required; neither review nor focused fixtures substitutes for them.
