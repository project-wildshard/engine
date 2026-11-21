# Publish the ready process IDs atomically

> Written by: Codex
> **State:** validated locally, 2026-11-20.

Run 44851747829, job 136686066626, fails the actual build-admission
proof at build-cpu-proof.mjs:54. The resistant process creates
actual.json before writeFileSync fills it. Its parent waits only for
existence and can parse the empty file on a busy hosted runner.

Write the complete process-ID document beside the destination and
rename it into place. Existence now means the IDs are readable before
the proof kills the provider. Admission, child reclamation, the fifteen
controls and every timeout stay unchanged.

The actual admission test passes, including all fifteen controls and
its final all-children-drained assertion.

Lane: codex-tc48.
