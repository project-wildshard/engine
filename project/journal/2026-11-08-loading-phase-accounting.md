# Ready phase clocks describe the same actual interval

The component's public API reproduced the review's incorrect split:
a one-second load with no download source reported Download 1000 ms
and Load 0. A scoped load with a real 400 ms download displayed Load
1.0 seconds despite reporting only 600 ms of load. A rounding-boundary
hold also froze the clock at a different instant from its raw totals.

Loads without a download source now assign that interval to Load.
A scoped download renders its real Download/Load split. The ready
instant is captured before the final clock sample and reused during
the hold. The formatter requires the supplied phases to partition the
total; it distributes only the fractional tenths left by rounding.

All 37 component cases pass in 639 ms, including the four ordinary/
scoped and source/no-source combinations, the held rounding boundary,
raw diagnostics and actual displayed headings. No style or layout
change was made. Real browser acceptance and publication still follow.
