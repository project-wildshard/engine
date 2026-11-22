# Sample two clock marks in the stall profile

Ring 2 run 45003368823 reached gameplay in Nine Dragon Stack.
The CPU profile had 2,184 samples and no named clock mark. The
exception then closed the context while the draw proof was sampling.

The profiler now runs two separately named marks before it stops.
The first sampled mark anchors the original profile. The play window
ends at the first mark's start. A profile with neither mark still
refuses to qualify, and the props and gameplay thresholds stay put.
