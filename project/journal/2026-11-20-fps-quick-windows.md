# Quick FPS fits one bounded GPU lease

> Written by: Codex
> **State:** source fix, 2026-11-20; paired live proof owed.

The old fresh pair missed two p50 comparisons: desktop High village
13.3 to 11.9 ms and native dock 6.6 to 7.3 ms. Its 15-second dock
covers less than a full rotation and includes 57–58 post-control
program links. Its village halves the original 20-second dwell.
Startup and view weighting are plausible causes (inference); cooling
and GPU overlap are not established for those complete captures.

Quick now samples 30/25/40-second dock, beach and village legs and
keeps the original 20-second village dwell. Every waypoint remains
required, with unchanged navigation and raw-frame checks. The five
cold routes take 475 seconds, leaving 65 seconds for boots inside
one nine-minute capture watchdog. Browser admission is bounded to
30 seconds. The twenty-minute table wall clock includes queue time.
No warm-up frames are discarded. Qualification remains unchanged.

Longer original 30/40/60-second trials were preserved as incomplete:
4/5 in 842.208 seconds (desktop High's 90-second Home-region timeout),
2/5 in 793.551 seconds and 3/5 in 1046.497 seconds (cancelled after
excess shared-queue time). No GPU overlap was detected. Splitting
650 seconds of work across two or three leases displaced the desktop
batch behind repeated peer work. One lease removes those admissions
while retaining the full dock window and village dwell.

Validation: planning regressions retain all original qualification
windows/variants/repeats, all quick waypoints and the original dwell.
The ordinary push gate runs types, related tests and lint.

Lane: codex-tc48

The first one-lease run completed 4/5 in 701.670 seconds, zero overlap:
Desktop High again hit its pre-control 90-second Home-region timeout.
Quick now retries that unmeasured boot once in a fresh browser, after
preserving its exact failed report. No route/frame failure is retried.
The same twenty-minute clock includes both attempts and queue waits;
output explicitly records every cold boot retry. There is no timeout
raise, sample reuse across invocations or frame selection.
