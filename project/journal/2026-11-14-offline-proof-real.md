# offline-proof --real, for OF18 (buddy-engine)

- OFFLINE OF18 runs `offline-proof.mjs` against real staging. With only
  `--base=https://staging.wildshard.io` the staging channel still loads
  through the stamping proxy on 127.0.0.1, and real staging's documents
  carry their own world stamp naming `packs.wildshard.io`, which sends no
  CORS header to a loopback origin: even the online warm visits died on
  "Failed to fetch" (release file, placements). A harness fault, not a
  staging verdict.
- `--real` makes the staging channel the `--base` site itself: real
  documents, release file, packs and service worker. The world door is
  still the stand-in (`routeWebSocket` on the rooms host), so no seat is
  taken. It refuses prod's origin and `--one-origin`.
- First run (v0.1.19, 7251ca24, offline, deck and resume): Driftwood,
  Nalati and Pine reach play from cache with the offline card over the
  world; the Open Plot drops to the title before play (red).
