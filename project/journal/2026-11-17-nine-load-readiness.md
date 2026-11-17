# Bound hosted Nine readiness by the green spread

> Written by: Codex
> **State:** fix forward, 2026-11-17.

Run 44049207653 timed out waiting for real Nine control at 180 seconds;
it never reached the props-stall assertion. Its preceding green was
44046961050. The only intervening source changes were profiler clock
anchor processing after readiness, unrelated command-proof tooling and
docs. No game, renderer, Nine pin or boot source changed. This points to
hosted runtime variance, not evidence of a Nine source regression.

Six green load receipts, total elapsed milliseconds:
44035389220 166456; 44040033228 115898; 44040038389 114726;
44042345263 154773; 44042429035 124506; 44046961050 98239.
Their range is 68217 ms. Bound readiness at maximum plus one observed
range, rounded up to a whole second: 234673 -> 235000 ms. The earlier
180000 ms limit had only 13544 ms above the slowest successful total
load, despite the measured 68217 ms spread. Total load includes setup
and navigation, so using it as readiness's envelope is conservative.
There is no failed-run timeline, so this remains an inference rather
than a measured completion time for the failed boot.

Keep the strict props idle limit at 1200 ms in a 1500 ms window. Green
props idle ranges 698-843 ms; the deliberate two-second sleep still
fails at about 1481 ms. Street counts, hardware timing and NB8/NB23
remain unchanged. A missing-control boot still fails after 235 s.
Persist load-error.json with the original error, page errors and a
best-effort boot timeline before teardown. The original failure is
re-thrown; a missing timeline cannot turn failure into success.
