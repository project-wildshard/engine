# Read only appended bytes while publication settles

> Written by: Codex

> **State:** built locally, 2026-11-16; HOW-WE-BUILD TS12k.

Qualification now discovers the receipt once and retains a bounded tail
reader while waiting for the actual command release. Unrelated complete
lines consume only their new bytes. Partial JSON stays pending within the
original drain deadline; it cannot qualify a command.

Before a positive result, the reader hashes the complete current raw,
proof and log and runs the original full qualification again. This single
final validation detects historical prefix rewrites as well as truncation,
rotation and changed raw/proof evidence. Repeated pending polls avoid
rescanning old bytes; final validation deliberately reads them again.

Actual producer records exercise eight unrelated appends, a split release
line and a successful completed release. Instrumented counts prove each
pending byte is read once and discovery runs once before final validation.
Six changed-input controls refuse: truncate, rotate, rewrite, rewrite plus
append, proof change and raw change. Real delayed release and every prior
owner, zombie, deadline and provenance refusal remain covered. This is
fixture qualification, not an engine full-gate measurement.

J206 found a normal shared-log append could arrive during final hashing.
Final validation now hashes exactly the previously observed prefix using
a fresh private no-follow fd with the same device/inode. The full join
reads later rows normally. Actual-producer controls append an unrelated
release at that exact read boundary and qualify; a duplicate owned release
at the same boundary refuses. Historical rewrite-plus-append still refuses.
The census lifetime also requires a strictly positive observed interval.
