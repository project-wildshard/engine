# Keep durable saves ahead of download cache pressure

RT3's historical hosted 50179df Chromium journey entered Ember but reported
savedOk false. Its retained trace ended before that save, so the original
refusal has no native error evidence. Later unchanged-engine hosted 6c8a2ec
and 0649b30 journeys pass. This commit does not retroactively attribute
that intermittent failure or claim it is fully explained.

A separate real native reproduction does establish a storage failure:
the actual openIndexedSaves API aborts later writes with QuotaExceededError
while the known downloadable asset cache occupies shared origin storage.
The last good save survives, but the candidate is not durable. A private
loopback-only CDP fault control fixes the same 3 MiB quota for old and new
code; it never overrides a game origin or changes a product/proof limit.
The web Storage Estimate quota is padded by 10 GiB in this Chromium, so
the control reads the native quota separately rather than treating that
padded number as available space.

On that named native quota refusal, wait for the transaction abort, remove
known completed downloads from ws-assets-v1, then retry the same strict
IndexedDB write once. Native resource timings supply existing same-origin
URLs and measured body sizes, largest first; deletion stops after enough
bytes for the attempted write. No Cache.keys enumeration is introduced.
The page's retained boot-resource measurements complement the browser's
bounded resource buffer, so early known downloads remain available after
that native buffer fills.
A real transaction completion is still required for
true; other failures and an unsuccessful retry remain false. No database,
last good progress, identity, setting, epoch or service-worker code cache
is deleted. Normal writes add no cache lookup or boot work. There is no
global Cache.keys scan, network send, timeout, schema or deadline change.

The first native prototype unlinked the whole cache. Its live Cache handle
kept bytes charged, so it stayed red and was not published. Deleting its
known entries actually frees the quota: the same twelve writes change
from three true/nine false to twelve true; the last good document and the
final candidate both read back exactly from the real database. Native
usage falls from 3.31 MB to 1.47 MB; the quota remains exactly 3 MiB.

J206's MUST caught a real new race: an older recovery retry could overwrite
a newer same-key write or resurrect a deletion. The complete attempt,
reclaim and retry are now serialized per key; close drains the admitted
queue before closing the database. An actual native barrier at cache
deletion reproduces resurrection on the uncommitted prototype and retains
the newer deletion on the serialized implementation. The SHOULD about a
full native timing buffer is covered by retained actual resource facts,
without introducing a native cache enumeration.

Manual native old/new evidence and review are recorded by the shell lane;
the full normal engine queue and exact hosted release proofs remain gates.
