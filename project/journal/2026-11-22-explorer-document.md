# Identify the Explorer document at creation

Ring 2 run 45003368823 drew both Starfall cards and then reported a
document change during pixel validation. WebKit recalculates its
time origin from the wall clock on each read. The browser tracks
the drift as https://bugs.webkit.org/show_bug.cgi?id=258572.

Mark each freshly loaded Document in the proof's init script.
Stable identity lets a live document finish with different clock
reads. A replacement document still refuses when the clock repeats.
The proof keeps the time origin in its diagnostics.
