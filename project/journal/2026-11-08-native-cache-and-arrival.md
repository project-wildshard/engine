# Keep native cache work and arrival inside boot ownership

Production v0.1.2 reproduces a pending downloadPorts.held.keys native scan
at title pagehide, followed by WebKit Cache API operation failed / Context
is stopped. Both synthetic and trusted GRID taps reproduce it; a home-cell
control narrows it without a road. The global scan is redundant because
every indexed member already passes its own response/type/length check.
Remove enumeration and keep that authoritative per-member validation.
The first candidate exposed the second native census, Cache.matchAll,
in the same title read-ahead at pagehide. Remove that native bulk path
as well; requested files still receive their individual cache checks.
Full Ember cold return then reproduced the same error with individual
Cache.match calls still running. The title now stops read-ahead and drains
its owned native calls through the existing leaveSaved handoff before
navigation. Its four-second navigation bound is unchanged. Cancellation
also prevents a late packs-book reply from opening a new cache, and stops
post-cancel manifest work and the next member lookup batch.

A focused title boundary test holds the native read across cancellation:
the download rejects immediately, leaving waits for the read, and no
subsequent native read or network request starts. All 45 focused checks
pass in 2.70 seconds (50 including overlap controls in 2.71 seconds).
The real persistent WebKit Ember repeat now passes road crossing,
forced-byte-cache-deletion return and actual browser-process kill/restart.
Every navigation has zero pending native cache calls, and page errors
are empty. This is a local full-catalogue candidate proof; hosted staged
Chromium/WebKit and the production repeat are still required.
The full hook first found two old inline-epoch VM fixtures without DOM
template APIs (5975 other cases passed). They now execute against real
Happy DOM template nodes, preserving the epoch/retry/handoff assertions;
the focused four-case check passes in 276 ms. Repeat the whole gate.

The candidate's real Chromium one-byte quota override produced the
native QuotaExceededError and still reached Nalati's completed card,
31 worker frames and no page errors. Its real WebKit Ember crossing,
cold return and process-kill recovery restored the saved pose within
0.03 mm; native navigation errors remain explicitly open until the
second enumeration repair and hosted proofs finish.

Two exact hosted Chromium runs fail Nalati at finish with cache-write
QuotaExceededError after world/shader work completes near 25.9 seconds.
Verified network bodies now remain usable when disk publication exhausts
quota. Stop further writes for that download, retain real streamed/hash
completion counts, grant no cached-byte credit, and publish no held-parts
index for unkept bytes. Other cache protocol faults and corrupt bytes
remain explicit failures. No save, identity or epoch storage is deleted.

Hosted WebKit separately sees blank/default first GRID or saved-Ember
card metadata before correct adoption. The same existing HTML card is
assembled detached, gets its validated arrival name/art/clock, then is
inserted atomically. Style and layout remain identical. The twelve-second
self-reload guard still recognizes a partially parsed detached card.

Existing parser/download boundary tests cover the split-document edge,
missing/unfit cached members, no enumeration, quota refusal and retained
non-quota failure. Full real candidate, hosted staged and persistent
WebKit proofs remain required before declaring these rows complete.
