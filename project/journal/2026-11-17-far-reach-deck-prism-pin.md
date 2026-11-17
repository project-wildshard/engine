# Far Reach rev 4: one prism per deck (NET-LAG NL13b3, opus-netlag)

- Staging v0.1.34 corrected the owner on Far Reach 8.5 to 43.6 times a minute (B2 allows 2). A native per-seq probe at
  0 ms showed page and room stepping the same command from the same state to different feet: the two worlds hold the
  same colliders in a different order, and each deck was six overlapping rotated boxes, so the capsule's contacts on
  the boxes' buried edges depended on that order.
- `test/net-predict-collider-order.test.ts` walks each pinned deck for four seconds in two worlds that differ only in
  the order three far-off boxes were added: rev 3 parts by 2.08 cm on Sunrest; rev 4 (shard-sky-reach `15bd0b6`, one
  twelve-sided convex prism per deck, published from Actions run 44100749664) parts by 0.
- Pinned with `node scripts/pin-shard.ts far-reach 4 5bc5adcf… staging` (publish's own engine dispatch was skipped:
  no app token). The staging snapshot refresh also picks up the catalogue's current placements, as pin-shard does.
