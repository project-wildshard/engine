# Record the Ring 1 digest with a shard pin

Brasscap rev 13 changed the 240-tick digest to `2639ee6c1363e0e1` in
run 44636108350. The pin workflow committed the rev 12 digest alongside the
rev 13 revision. The previous workflow prepared Ring 1 slices only.

The pin workflow now installs the same Ring 1 inputs as hosted CI after
moving a member's pin (and recutting its slice if needed). It records only
that slug on the Ubuntu runner and adds the resulting baseline to the pin
commit. A no-op pin and a slug outside Ring 1 skip digest recording. Digest
entries are platform-specific, so the Ubuntu run records the Linux entry.

Recording treats a changed digest as a successful measurement. A failed
step still fails recording and leaves the baseline file intact. Ordinary
Ring 1 comparisons still fail for a digest mismatch.
