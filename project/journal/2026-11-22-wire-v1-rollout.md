# 2026-11-22: Wire v1 rollout

J492 puts the WR15 release in the 0.1.x train. The 0.1.73 build
advertises its own client floor and the updater paints an Update required
card before the bounded cache reset and reload. Later patches keep this
floor. Epoch-2 progress and the device identity use the existing stores.

- Run 45104046415 found a stale epoch-floor test. The old floor still
  applies through 0.1.72. The version proof covers the new floor at
  0.1.73 and later.
