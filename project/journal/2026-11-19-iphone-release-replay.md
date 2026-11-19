# Keep device attempts in the phone release report

> Written by: Codex
>
> **State:** IP26 code and recorded replay, 2026-11-19. Live capture queued.

The release suite runs the engine harness under the two phone locks.
It still needs three cold boots each for Brasscap and Nine, and a full
60-second Nine walk. Keep the zone, build, control time and last loading
stage for each attempt in the printed report and dated history row.
A mismatched zone or a forced reload cannot contribute to a cold median.

Replay the recorded Nine control at 16.8 seconds and Pine's Safari
window loss at 60.6% Spawn detail through bench.mjs's release command.
Pine is a deck sample filed under the wrong task in this test. Its failure
stays visible while Nine keeps its build and the incomplete medians stay
unavailable. The mini-phone-queue lane will produce the first live line.
