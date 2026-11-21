# FM11: the Ring fixture's strip room

Lane mini-close (2026-11-21), from main-watch naming failmodes at 175cdf5b1 (run 44938957670).

- failmodes has failed its fixture build on every main push since 2026-11-19 (b5d85c8 onward). The fixture builds on
  Ring 1's catalogue, which stands Brasscap road in for every shard outside the ring. That road bakes 4,023,179 wire bytes
  against the 3,552,000 shipping room; the real catalogue bakes 3,202,461.
- Fix: `gridStripOverRoom` lets a Ring catalogue build report the overage like a staging-snapshot dev build. Releases and
  the shipping catalogue still fail. The room does not move.
