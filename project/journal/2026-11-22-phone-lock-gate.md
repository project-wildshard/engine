# Phone queue lock gate

> Written by: Codex
> **State:** implemented, 2026-11-22.

- The runner reads `devicectl device info lockState` before taking a
  pending job. A passcode lock leaves the job pending and logs once until
  an explicit unlocked read, even if an intervening read fails.
- Stubbed device reads reproduce the original premature start and verify
  unlock, repeated polls, a second lock, and a clean first attempt.
