# Size the push CPU grants from measured work

VB15 uses the per-file census in the meta repository. The cook file
averaged 1.35 cores under its four-slot grant. Two slots still admit its
encoder children. The lease-order partitions 1 and 3 averaged about a
third of a core and now reserve one slot for their Python and Git work.
Both timing and uncapped encoder proofs retain machine-wide exclusivity.

The broker reserves space in a run's budget before entering the machine
FIFO. A saturated run cannot queue a grant that blocks another run from
using available machine slots. The broker's socket proof exercises both
scopes with real command owners and checks that both queues drain.

On a92de6c, the six-worker trial passed all 6,516 cases with one existing
skip, but took 483.8 seconds (438.6 seconds Vitest). Q327 had proved the
same test inventory at ten workers in 203.5 seconds. The local reference
took 328.3 seconds and failed the unrelated ci-bisect Git fixture during
pack-directory cleanup. The runs had different host load. Keep ten
workers until six can meet the wall-clock and repeatability targets.
Clock-driven server proofs still hold their grants while live.
