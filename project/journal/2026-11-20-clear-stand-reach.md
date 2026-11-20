# A seat's clear stand casts only at what can reach it

The coordinator handed me an amber: `test/served-world-prunes.test.ts` ran
62.6 s on main's hosted `ci` against its 60 s budget (J295).

## What made it slower

The test's own code hasn't changed since 11-14. On 11-19, `177540a60`
("seat a fresh join where it stands clear", NL13b5) made every fresh seat
call `clearStand`, and the amber fired that same day. `a972c6e5a` later reused
the ray vectors, but the shape of the work stayed the same:

- collect every enabled, solid world collider in the room;
- cast nine footprint rays at each of them one by one;
- test the standing capsule against each of them.

Nalati's room has 2,687 such colliders: 2,021 convex hulls, 494 boxes and
169 capsules. That is about 24,000 single-collider casts per seat. The test
seats a thousand visitors, so most of its time went there. A profile of the
visit loop showed `seat` → `place` → `aside` → `clearStand` taking 4.4 of
8.8 s.

## The change

`clearStand` now gives each collider a bounding sphere, computed once and
cached on Rapier's shape object. A shape edit replaces or drops that object,
so a changed collider is measured afresh. Colliders whose sphere can't reach
the column the rays and the capsule fill are passed over:

- the column runs from the rays' lowest reach to the top of a capsule
  standing on the highest floor they may find;
- meshes, heightfields and compounds have no cheap bound, so they are
  always tested.

Rapier's broad-phase queries would be quicker still. But a room seats before
its first step, which is why `clearStand` reads poses directly, so I left
those alone.

## Proof

- **Same answers:** the new `test/clear-stand-reach.test.ts` compares
  `clearStand` with the old whole-world scan at every point of a 1.5 m grid
  round Nalati's and Nine's spawns, at three heights: 867 points per cell,
  covering stands and refusals alike. Every answer is identical.
- **Existing coverage:** `dedicated-seat-aside` still proves every fresh seat
  in every shipped cell stands clear, by its own whole-world scan.
- **Speed:** locally, the file went from 13.4 s to 5.5 s. On the hosted
  runner, which was about 4.6 times slower, that is roughly 26 s against
  the 60 s budget.

The test's limits and its thousand visits are unchanged. Real seats get the
same saving: every fresh join in a big cell was paying for it.
