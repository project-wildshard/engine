# Measure actual CPU instead of counting sleeping helpers

HS8 needs actual thread activity, memory and child-lifetime observations.
The earlier 88 ps snapshots report up to 503 threads and ten runnable,
not an active-core cap. The three-minute hook remains open at 204.7 s.
This is manual external instrumentation, not a new test in local hooks.

The observer attaches to an explicit existing UID-owned PID. It never
signals that owner or changes its environment. Kernel PID birth identity
binds every observation; known detached children remain tracked. A PID
that exists but cannot be inspected stays uncertain instead of being
called drained. Linux uses proc clock ticks and TID/start identity.
Darwin uses exact-size libproc structures and unique kernel thread IDs,
not reusable pthread handles. Unsupported unique-ID APIs refuse.

Real calibration exposed two distinct counter units. A 100 ms Python CPU
control first looked like 2.4 ms because task counters are Mach ticks.
The real 125/3 timebase fixes that. Thread counters already report ns;
scaling them again turned a 750 ms thread into 31.25 seconds. Separate
process and thread assertions now catch both mistakes. Native thread IDs
are independently compared to Python's actual get_native_id values.

The quick real CLI control runs a busy native thread with a sleeping
helper, an independent sleeping process, then a surviving orphan writer.
All observed normal children drain. The actual orphan remains live after
the observer reports failure, proving this tool never signals it.
Controls finish in about 1.46 s. Raw task ticks, double-scaled thread ns
and reusable pthread handles each fail the actual CLI; originals are
restored byte-for-byte. All control actors are private and bounded.

Samples expose positive thread CPU deltas over an interval, not a count
of simultaneously executing cores. Process CPU sums are lower bounds
because short-lived/unreadable workers can be missed; sampling gaps and
counter resets are explicit. Read-window duration includes observer scan
skew. RSS sums include shared pages. Observer CPU cost is reported.
A 64 MiB report and 8,192 observed-identity cap bound this manual tool.
No gameplay clocks, file/shard deadlines, admission policy or cases change.

The plan job runs only this quick OS/CLI calibration on Linux. The actual
original nine-file sequential and contended runs, their case membership,
and the complete normal hook census still need receipts. No saving,
quarantine qualification or completed HS8 row is claimed by the tool.

Kernel references checked alongside the installed SDK and real controls:
https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/kern/bsd_kern.c
https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/proc_info_private.h

The one-shot review found two MUST fixes and one SHOULD. Required API
capability is now checked before observation; non-race live-counter and
known-identity errors preserve refusal status. A real unsupported libproc
flavor against a live short control reproduces the reviewed policy's
false exit0 with zero threads; the fixed CLI refuses exit2 before reporting
success. This diagnostic backports the reviewed success-on-drain policy;
it is not a fabricated OS row or claimed production failure.

Linux PID/thread inventories now use streaming scandir with hard bounds
before collection, matching Darwin. Public cap arguments only narrow the
fixed maxima. Real CLI process-cap2 and thread-cap1 controls refuse with
named messages while their actual target stays live. All four controls
pass1.70s; CI must still prove the Linux implementation on a real runner.
The orphan actor atomically publishes its final closed-write marker,
which the proof awaits before removing its own temporary directory.
