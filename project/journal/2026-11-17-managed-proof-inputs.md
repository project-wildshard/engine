# Make the actual engine install eligible for proof reuse

FL9's first real-engine probe returned no dependency identity, despite its
Git regressions passing. I interrupted my normal gate before publication.
The installed pnpm snapshot adds `gitHosted: true` to an otherwise identical
Git-archive resolution. The engine also uses pnpm's managed global virtual
store, which the old adapter supported only for npr's separate tool install.

FL9a tolerates only that generated true flag for lock comparison. All other
resolution, path and commit inputs remain exact, and the fingerprint still
includes the raw installed snapshot. Global package contexts include their
sibling dependency and peer aliases, with cycle-safe traversal. Source
aliases outside the managed stores still refuse. Cached npr manifests use
their verified enclosing install's pinned manager.

A metadata-only census measured 21,840 engine entries / 1,088,946,071 bytes
and a largest file of 148,937,304 bytes; npr's separate graph has 797 entries /
127,977,181 bytes. The old 512 MiB cap also made every engine proof miss.
The adapter now binds every byte under a 2 GiB aggregate and 256 MiB per-file
bound. Its version changes, so older incomplete graph identities cannot
substitute for the new graph.

Three new managed-layout controls failed first. The repaired cohort covers
working package/peer byte changes, changed resolutions, working live aliases,
an oversized sparse file refused before allocation, and a direct full proof
surviving a separate real Git rebase. The actual engine identity is now
non-null and stable across repeated full reads. Real installed-program
qualification also passes: framing collision refused, npr tool bytes bound,
corrupt tool genuinely fails, exact restoration restores the identity.

The opus-mfm2 sequence is reproduced against the prior reader: all four
consecutive disjoint rebases return `No matching current-runtime full proof
for the tested tree`. With this reader the same native Git case uses one
completed full proof and four real syntax-plus-affected-test rounds. Each
round keeps its original full run, and composed intermediate receipts never
become a new full basis. All 27 layout/delta controls pass.

J393 run 44137015477 was independently retried once as requested. Attempt 2
was cancelled before jobs appeared; it is not evidence of a flake. Follow
the superseding main CI while this cohort remains unlanded.
