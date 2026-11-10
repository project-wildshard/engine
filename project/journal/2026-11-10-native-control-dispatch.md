# Invoke the refusal control through its declared interpreter

The fresh v0.1.6 local release check passed 6,433 cases and refused one:
the malformed-inventory control received a native command timeout at
510 ms, with no stdout, instead of the malformed row. The collector's
500 ms execution limit fired before the control produced its data.
The test's profile and original marker remained; disposal stayed false.
Exact hosted CI and Ring 1 on aeef0f5 were green. A quiet focused run of
the unchanged case passes in 2.67 seconds, so this is not a deterministic
parser or cleanup failure. The full red is retained locally.

The control already used a shell script, not a Node script. It now
passes that owned script's absolute path to /bin/sh explicitly instead
of asking native spawn to find and execute a newly written ps script
through PATH and its shebang. This removes incidental command lookup
and script dispatch from the malformed-data oracle. Both control bodies
are unchanged, including the deliberate five-second sleep. Production
inventory, its 500 ms limit, the five-second drain, ten-second wrappers,
one-second wrapper termination, raw-row bounds and retention assertions
are unchanged. The focused forward passes in 2.11 seconds.

This is a narrow fixture dispatch forward, not a claim that host
scheduling or kernel policy has been causally isolated. A separate cold
dispatch measurement command was rejected by the command guard before
execution; it was not rerouted. No timing result is claimed for it.
The changed tree still needs a normal complete gate and exact hosted
verdicts before any release tag. No quarantine or deadline is changed.
