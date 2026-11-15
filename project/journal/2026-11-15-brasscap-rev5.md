# Brasscap rev 5 pinned (opus-brassgun4, TEMPLATE-E2E)

- Staging showed no bandits or Wyrm in Brasscap's cell although the
  0.5.1 upload (rev 5, `a53826e5…`, shard-brasscap `57e5c6f`) went to the
  staging channel. The cell is a pinned one, so the release file (serial
  86) and the server book still named rev 3 (`5400ea84…`): its 12 spawns
  bind no creature in a client script, and the old shard is not a data
  cell, so `NeighbourLife` drew none of them. Rev 5 binds 19 of its 21
  spawns and is a data cell.
- Engine pins `blender-template` revision 5 (20,534,784 bytes, sdk
  0.3.1, shard-format 0.5.7, engine 0.1.21 preparation, so `pins` warns
  "stale preparation"), by hand from
  `GET /api/catalogue.json?channel=staging`, as Template's revs were.
  Its tarball is on the `pins` release.
- The released v0.1.1 save is refused by rev 5 as by rev 3.
- Physics route: rev 5's camp 2 sits on a 6.5 m block (x 10 to 26,
  z -43 to -25) with a ladder on its west face, so the old "ledge stair"
  leg walked into the block's face at x 9.6. The leg now ends at the
  ladder's foot (8.4, -28.4); the porch and camp 3 legs pass unchanged.
- `test/pins/cooked.json` is a report baseline, not a gate, and was not
  re-recorded (Template's rev 6 left it too).
