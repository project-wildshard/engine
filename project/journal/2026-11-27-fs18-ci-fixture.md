# FS18 local push fixture in hosted CI

> Written by: Codex

Main CI run 45949869078 failed the real Git fixture for an FS18 pin push. The fixture simulates a local lane pushing to a disposable remote. It inherited `CI` and `GITHUB_ACTIONS` from the test runner, which placed that simulated push outside the local FS18 path and caused J375 to reject it.

The fixture now clears those variables for the simulated push. It still verifies that the early gate and the push receive the marker for the exact same tip. Run the fixture with both variables set in the parent to reproduce the hosted conditions.
