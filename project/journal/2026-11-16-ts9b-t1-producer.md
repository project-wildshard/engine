> Written by: Codex
> State: built; hosted admission proof pending, 2026-11-16.

T1 waited for every packed share even though only share 6 makes its build.
Share 6 now has its own workflow job ID and keeps the visible tests (6)
name. Native YAML aliases share all 42 original steps, environment and
outputs. Both jobs still pack against six: shares 1..5 and share 6 retain
the same membership, build, reports, reuse/docs gates and failure policy.
T1 depends on the successful producer; the whole workflow still gates all
six shares. The timings collector waits for both job IDs.

Parsed-YAML comparison matches every original packed and T1 step. Inventory
controls cover 0..100 test shards, exactly once across the six shares and
one product producer. Actionlint and 72 focused cases pass; types/lint pass.
An actual hosted run must still demonstrate earlier T1 admission; no wall
saving or parent TS9 completion is claimed before that observation.
