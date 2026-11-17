# Keep the local proof fixture local inside CI

> Written by: Codex
> **State:** source repaired, 2026-11-17; hosted confirmation pending.

Main fe3ee4619e, run 44078032864, tests (4), failed all thirteen
local-land-delta cases before their assertions. The fixture copied the
host's CI markers into capturePushTree, whose production contract
correctly refuses local cache proofs in CI.

Reproduced with CI=true and GITHUB_ACTIONS=true: thirteen failures with
"Missing clean fixture proof context". Give only the synthetic local
publisher an explicit local proof environment, including its own push
refs. Keep the actual test runner in CI and leave production unchanged.

All fifteen cases now pass under both CI markers (6.62 seconds). New
controls independently verify that CI and GITHUB_ACTIONS each refuse
proof capture, both with and without valid push refs. Existing missing,
partial, runtime, lineage, overlap and harness-change controls remain.
No pin, production admission, test budget or gate policy changes.
