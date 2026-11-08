# Keep the flaky proofs visible

J193 gives the four named flaky files a time-limited, owned quarantine.
Port owns the manifest and actual runner; this change wires that runner
into both remote workflows with full pinned products and normal exits.
Only the remote blocking cohorts exclude the active manifest entries.
The ordinary local inventory and pre-push retain those files. Expired or
invalid entries remain the loader's responsibility, never a blanket skip.

Quarantine jobs are visible and nonblocking, and are absent from the
blocking verdict's needs/result list. A quarantine failure is not labelled
a blocking red. The full outgoing history scan and lint/format remain on
docs-only pushes, as the final grill decision requires.
