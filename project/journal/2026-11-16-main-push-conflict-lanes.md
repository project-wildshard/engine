# Keep a conflicting lane from blocking shared main

> Written by: Codex
> **State:** implemented, 2026-11-16.

M11 requires duplicate patches to disappear during sync, and a real
conflict to hold only the lane that owns it. Replay each local commit
independently. Drop equivalent patches already on origin and empty
replays. Hold conflicting commits and that lane's later commits under
`refs/wildshard-held/<lane>/<sha>`; retain their recovery records in
the git directory. The original committed bytes remain recoverable.

New commits identify their lane in the message. A held lane gets a
receipt, a prompt and an exact `--onto` recovery command. Other lanes
continue syncing and pushing. Recovery clears the matching holds
after its push succeeds. Unlabelled old commits retain a SHA-based
name, since their actual lane cannot be established from the author.

Real Git cases cover the duplicate patch, an independent commit after
a conflicting peer, the peer's later dependent commit, byte-preserved
recovery, and unrelated dirty, staged and untracked work. Existing
push-race, lock, hook-refusal and stale-recovery controls remain.
