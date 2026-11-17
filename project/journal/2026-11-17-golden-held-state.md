# Name changes during the held native wait

> Written by: Codex
> **State:** implemented, 2026-11-17.

NB18 hosted WebKit run 44024957953 captured one camera, then refused
camera two because frame, clock, camera or player changed while held.
Its error did not say which. The same two-camera local WebKit run
passes, so retain both snapshots in the refusal to diagnose the exact
hosted client. The invariant and deadline are unchanged. A focused
test verifies unchanged state passes and real player movement still
fails with both before and after positions.
