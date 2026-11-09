# Measure what the native story process used

The same released source has very different hosted story clocks.
Two fresh runs of 5baa0fa retain discovery's 7618 inputs and 15 parts.
Their replay totals are 78.744 and 30.838 seconds.
Awareness retains 3977 inputs and 11 parts, at 47.462 and 20.193 seconds.
Those are elapsed measurements, not a diagnosis of CPU starvation.
They do not distinguish extra computation from less time on a CPU.

Report the actual recorder process's CPU and elapsed time at exit.
Use the existing product-session composition point.
Only the awareness and discovery recorder entrypoints opt into the report.
The main-thread guard excludes their independent native worker threads.
The process CPU sample includes those threads as part of that process.
It is not a claim to include independently spawned child processes.

The observer does not step a world, change a command or create a worker.
It does not change a snapshot, assertion, deadline or gameplay verdict.
There is no per-tick sampling or extra timer.
An exit sample includes module startup and the original cleanup.
It records exit status, uptime, user/system CPU and process maximum RSS.
Only the public recorder filename is printed, not a private path or data.
The short record is written synchronously to the existing stdout pipe.
An optional reporting failure cannot replace the original test outcome.
A missing diagnostic supplies no evidence.

The actual awareness story still passes every original assertion.
It retains its 3977 inputs, earned checkpoint and restored continuation.
The observer reports 34755.759 ms uptime, 54717.132 ms user CPU and
1360.606 ms system CPU, with maximum RSS 2061664 KiB.
The external OS reading is 34.81 s real, 54.72 s user and 1.39 s system.
The small difference includes process shutdown after the callback.
Hosted readings are needed before attributing the slow-run cause.

A separate actual checkpoint-getter experiment rules out another detour.
Thirty-two reads of a 12785358-character native checkpoint take 40.043 ms.
Its real snapshot hash is unchanged; no ownership-copy shortcut is retained.
The large measured cost remains encoding and native story execution.

No quarantine entry or deadline changes in this diagnostic commit.
New pushes and fresh dispatches remain the qualification source.
Publication waits for the current CI4 breaker to turn exact CI green.
J205 is unchanged: these fixtures are isolated local worlds, not live E7.
