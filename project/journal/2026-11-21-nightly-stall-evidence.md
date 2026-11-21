# Keep the evidence for a refused boot stall

Nightly 44913133771 caught 1.22 seconds of unexplained idle in Nine's
props stage. The failure JSON kept resource requests and the fault
string, leaving no timeline to identify the pending work.

Keep the profiler's exact boot timeline with a failed proof and its
compact stage summary on a green nightly head. The stall verdict
still uses the same threshold and named waits.
