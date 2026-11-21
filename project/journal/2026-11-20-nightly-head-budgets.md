# FS30: cold-cook and boot clocks

Nightly 44857730936 lost Pine's Chromium result to the browser wrapper
at 60 minutes. WebKit reached the 1,500-second cook limit. Cold local
Pine r9 took 1,043.5 seconds with one encoder worker and 548.2 with two.
The 644 stored object keys, manifests and server-pack identity matched.
Hosted Ring 2 now passes its available CPU allowance to its bounded
cook worker and logs the existing phase receipts. The cook limit stays
at 1,500 seconds, and the browser lease uses the job's existing ceiling.

Driftwood r8 diagnostic 44863911819 drew real frames without a
world-watch fault. Its gameplay probes ran for 97 seconds and exhausted
the screenshot deadline. Account for those probes separately and retain
all page faults and hover, draw and capture assertions.
