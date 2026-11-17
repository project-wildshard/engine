# ONE-FORMAT M6, relay owner opus-of-m6b (plan/of-m6b)

- OF10a1 one cache: the service worker's. The browser folder cache was built only for
  `firstParty: false`, and both browser readers refuse such a product before reading it, so it
  served 0 reads and 0 writes in a client build; deleted. `CachedFolder` loses `firstParty`;
  offline takes any visited entry that hashes. Ledger gate cache-provenance gone.
- OF10a3 built-receipt: the receipt and verdict tables were already keyed by content (source hash,
  index hash), so every provenance check in front of them goes. The build reader stays the host's
  capability; the stale-client check now covers a product whose path the verdict table lists (its
  own catalogue and placed uploads' cook rows), so an unlisted product is never "stale".
