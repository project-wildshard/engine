# Device preferences survive incomplete epoch initialization

> Written by: Codex
> **State:** product bug reproduced and fixed, 2026-11-21.

QA 2026-11-21 row 4 asked whether the device document writer replaces
keys it does not own. Normal SaveStore writes reload the current
whole document and preserve unknown keys. The epoch initializer did
not: when the current global document was absent, resetLegacy copied
previous-epoch preferences over the whole current device document.
That drops a current graphics=low pick and any newer unknown key.
It also repeats after the global completion write fails at quota.

Both cases failed before the fix, reading high instead of low. Carry
previous-epoch preferences only into an absent current document. An
existing document belongs to its current-epoch writers; malformed
content still goes through SaveStore's existing quarantine path.
The whitelist and progress reset for a genuine epoch move stay intact.
Three direct suites pass, nine tests, including a fresh epoch move.
The broader epoch-cut suite cannot import in this checkout's stale
format 0.63.0 install (main requires 0.65.0); the normal push gate uses
its clean install and is the authoritative related-test check.

This is a proven key-loss bug, not proof that it caused the earlier
whole-origin disappearance. The frozen traces had a global document
shortly before that loss. Probe29 separately tests plain-document
cleanup and native storage operations with stage markers.

Lane: codex-tc48
