# Compare smoke leaves against the prior week

TB-4a compares named leaf durations with three or more earlier samples
from the same cold/warm, platform and renderer profile. It uses a median
over seven days, excludes the current and future runs, and ignores torn
receipt lines. Thirty percent growth is reportable.

The seeded three-second decode regression identifies only packDecode.
This is the comparator proof. Persisting actual smoke receipts, selecting
their real leaf spans and planting the delay in real decode are TB-4b.
