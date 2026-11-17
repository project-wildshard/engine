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

Restore only the two globals the fixture changes. A broad Vitest
unstub removed shared setup's localStorage and broke the next test;
the ordinary push gate caught that fixture leak before publication.

Exact-client hosted replay 44030536433 named the actual difference:
player X 17.999985714116413 to 17.99998567712444 (3.7e-8 m), with
identical frame, clock and camera. The values straddle a float32 rounding
boundary but differ by much less than one native unit (1.9e-6 m there).
Compare player separation with at most one float32 unit per coordinate,
retaining both raw positions; the other fields stay exact. The actual
hosted pair fails first, then passes; a 10 micrometre move and any frame
advance still fail. No budget, camera, settlement or SSIM change.
