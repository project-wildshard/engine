# One normal gate for a ready FIFO cohort

J216 allows every lane to keep publishing. The queue now freezes the
ready FIFO prefix, clones origin/main as its private base, and rebases
each immutable requested history in order onto the preceding combined
main. It preserves original snapshots and request SHA/tree until every
result is known. In-progress capture and check-only jobs remain FIFO
boundaries. Source checkouts and dirty peer files are never modified.

The combined candidate uses the same full normal hook, exact-tree
verification, normal Git push and bounded race retry as a single job.
Green updates each covered request with its original provenance and
shared checked SHA/tree. A red candidate grants no proof to subsets:
recursive halves build fresh origin-based candidates and run their own
normal gates. Only a failed singleton names its actual owner; uncertain
publication stops bisection and requires remote verification.

Actual four independent Git lanes are all observed queued behind the
real worker OS lock before release. Old queue takes four full gates.
New queue takes one and publishes all four (4.84s including setup).
A real bad second lane yields five actual gates, only that lane fails,
and all three independent green lanes publish (8.25s). Every source
request and original dirty checkout stays unchanged. The fixture's
complete tiny gate caches only its exact tree for the actual Git hook;
no test selection or hook bypass is involved.

This is manual outer-edge evidence, outside automatic hook discovery.
A real engine combined full gate and exact hosted green remain open.

Before review, an actual changed-snapshot negative reproduces a newly
introduced boundary bug: cloning the snapshot without checking its
original SHA/tree could include an unrequested new commit. Guards now
verify the original before/after copy and the copied tree before replay.
Old red/new green6.50s refuses exactly that payload and publishes the
three intact requests through two fresh complete gates. No unrequested
file reaches the remote. Original FIFO proof now checks each published
tree's actual normal hook entries while allowing red bisection attempts
and shared green cohorts, retaining all other original assertions.
