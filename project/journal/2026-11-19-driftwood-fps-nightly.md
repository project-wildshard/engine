# Driftwood FPS nightly

> Written by: Codex

DF7 uses the J464 floors from the budget book and captures the full route
on an exact engine checkout. The nightly summary calls out each floor gap
and compares p95 against the last qualified run of the same host, GPU and
profile factors. It reports through DF15. A hardware Metal witness and a
qualified CPU profile are required to qualify a run.

The existing mini-1 runner is a Linux VM. The workflow reports the
missing runner until a macOS runner with the Metal GPU receives the
DRIFTWOOD_FPS_GPU_RUNNER label setting. The regression test adds 10 ms to
each phone-low frame and checks that the report names that profile first.
