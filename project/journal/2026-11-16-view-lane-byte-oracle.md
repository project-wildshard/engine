# Keep native view continuation checks cheap

> Written by: Codex
> State: J249 mode-1 fix, 2026-11-16; hosted proof pending.

Main CI43969009665 timed out the native guest-memory/host-clock test at
30 seconds. The unchanged focused case took 16.434 seconds locally. Its
245 frame boundaries each deep-compared the full 64 KiB guest memory
through the generic matcher, making the oracle dominate the guest work.

Native Buffer equality now compares the same entire buffers on every
original frame. No bytes, frames, clock/state comparisons, output checks
or pending/rate-recovery/refusal transitions were removed. The 30-second
timeout stays unchanged. The case takes 8 ms locally; all 13 view-lane
cases pass. Lint and types pass; pins refreshed stale generated mounts.
Other main-red causes are outside this focused change.
