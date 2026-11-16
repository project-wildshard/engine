# Teach the existing CI topology check about T1

> Written by: Codex
> State: built locally, 2026-11-15; hosted retry pending.

The first hosted branch run exposed an outdated assertion: land.test.ts
enumerated only the four original workflow jobs. T1 adds a consumer job
after the products producer, so it cannot satisfy the packed shares'
independent-start invariant. The original assertion was missed locally.

The test now names T1 explicitly and proves its producer dependency,
code/reuse verdict, four shards and shared build directory. The original
packed-share assertions remain intact for the other jobs. No landing or
reuse implementation changes are needed. All 64 cases in land.test.ts and
the two touched T1 tooling files pass locally, as does game lint.
