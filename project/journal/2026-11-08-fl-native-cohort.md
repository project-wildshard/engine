# Preserve native scheduling after quarantine promotion

The four quarantined files currently prove their behavior with one outer
worker in both hosted workflows. Passing there and later returning the same
files to ordinary two-worker contention could reintroduce their timeouts.

Register the three missing paths in the existing CI_NATIVE_GROUPS data:
the actual Titan rule checkpoints join escape-titan, and net-fuzz/Pine form
network-rewards. Escape was already registered and stays there once. The
incoming engine-ci planner consumes this existing registry and gives native
phases one outer worker. No competing scheduler or quarantine system is built.

The registry was clean before this change. The sharding lane's dirty planner,
workflow, duration and test files are untouched. No test, seed, tick, deadline,
assertion, product or quarantine entry is removed. Ring 1's historical slow
exclusions still need the appropriate blocking cohort before promotion;
registration alone does not establish that coverage or ten hosted passes.

An owned scratch diagnostic drove actual Vitest file discovery and the
incoming planner on the full post-promotion inventory: 1,144 discovered
files, six selected shards, each of the four affected paths in native exactly
once and ordinary zero times. Plan inventory/hash validation passed. This is
a configuration receipt, not another gameplay pass. The old sharding file
is an intentionally pending CLI proof, so invoking it through Vitest found
zero tests; that attempted invocation is not counted as a pass. The sharding
owner's uncommitted CLI proof and planner remain untouched.

Publication remains held at the v0.1.2 production barrier. This additive data
seam follows the locally prepared a88a9b2 proof ownership changes. The final
published batch must pass the ordinary full pre-push without bypass.
