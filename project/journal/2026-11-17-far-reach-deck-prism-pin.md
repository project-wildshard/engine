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
- The first local gate (J400) went red on three fixtures cut from rev 3: Ring 1's server slice (re-cut with
  `node scripts/pins.ts slice`), the released Far Reach save's proven pin (moved to rev 4; it still resumes in place and
  keeps walking), and side parity's recorded page half (re-recorded with `scripts/side-parity.mjs --record
  --shard=far-reach` on a fresh `pnpm build:game`: each deck is now one hull on the page as in the room, 0 findings).
