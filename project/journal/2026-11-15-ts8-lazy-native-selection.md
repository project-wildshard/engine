# Keep explicit native selection off Playwright's graph

The native fixture imported Playwright even when its parent had already
selected the exact browser. Load that fallback only when no existing
explicit or system executable matches. The owning native shard passes
its prepared executable to children, preserving that same selection.

Five fresh explicit-selection processes took 177.0 to 288.0 ms before
and 33.2 to 38.3 ms after. A fresh-process control sees six Playwright
cache entries with the old helper and none with the new helper; both
explicit environment selectors retain their original precedence.

All four warm-up controls and the eight original native Escape controls
pass. Native Escape is 11.06 s locally. Its deadlines, trusted input,
native inventory and cleanup assertions are unchanged. The hosted
ten-run twelve-second bar remains open until actual runs prove it.
