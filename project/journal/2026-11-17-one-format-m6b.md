# ONE-FORMAT M6, relay owner opus-of-m6b (plan/of-m6b)

- OF10a1 one cache: the service worker's. The browser folder cache was built only for
  `dangerousGrant: false`, and both browser readers refuse such a product before reading it, so it
  served 0 reads and 0 writes in a client build; deleted. `CachedFolder` loses `dangerousGrant`;
  offline takes any visited entry that hashes. Ledger gate cache-provenance gone.
- OF10a3 built-receipt: the receipt and verdict tables were already keyed by content (source hash,
  index hash), so every provenance check in front of them goes. The build reader stays the host's
  capability; the stale-client check now covers a product whose path the verdict table lists (its
  own catalogue and placed uploads' cook rows), so an unlisted product is never "stale".
- OF10a4 native-read: every browser product gets the build reader, pack range reads and the paced
  section parse; the reader is the host's capability, not a provenance grant. (Corrected the ledger:
  identity had 2 folder.ts references, the `instance` at admission's end.)
- OF10a5 identity: the api-server owns slugs per account (DEL5; adopt gave the operator all 29;
  `account-upload.test.ts` proves a stranger's `dunes` upload is 403), so the engine's reserved-slug
  list goes. `admittedShardInstance`: a catalogue-placed slug saves under its placement's instance
  (our saves unchanged), anything else by (origin, slug). Private save namespaces refuse for all.
- OF10a6 catalogue-manifest: a manifest's `shardfile` descriptor is admitted like any upload's
  (same-origin, hash-checked), and selection keeps the catalogue's other shards for every shard.
- OF10a7 provenance-flag: `FolderOptions.dangerousGrant` and the descriptor reader's field go.
  What is left of the option is the dangerous gates' input only: `DangerousProvenance` and the
  host's grant `dangerousTrust()` in `dangerousGates.ts`, the one file that still spells it.
  `browserShardfileOptions(base, trusted)`, `prepareRuntimePage(.., { trusted })`,
  `RuntimePageResident.trust`.

## Review fixes before the land (OF10a4, OF10a5)

A `claude -p` review of the branch found three bugs, and the T1 Template journey failed (never reached play):

- `buildRead` had become unconditional, so an unlisted outside product took the build path, which casts the
  index and checks sizes only. The browser reader is now given to a product the host trusts or one the build's
  verdict table lists; anything else has no browser reader and fails closed, as on main.
- Named JSON reads keyed `builtJson` on `descriptor.receipt`, which the build path never sets, so every `jsonSchema`
  file threw in the browser. It keys on `descriptor.built` now.
- The native read never named the save identity. It calls `admittedShardInstance` too, and `clientSource` refuses a
  slug the catalogue does not place that arrives without one (the old backstop, keyed on placement, not provenance).
