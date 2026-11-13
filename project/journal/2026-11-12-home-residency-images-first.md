# Home residency on images-first (QA 11-12 row 53, GC21)

- Desktop Nalati and Sky Reach stopped at finish: "Home residency differs from the admitted whole-runtime cost". The boot
  admits the home at the compressed reading before the texture mode can resolve; the grid entry charges the reading of the
  mode it loads, and a desktop with no KTX2 set for its tier loads images. Only those two homes carry an images-first reading.
- Fix: both boot sites admit the images-first reading beside the claim; `handoff` re-prices the unused sole boot reference
  onto it through the allocator, and still refuses any other cost. Unit test `src/client/game/grid/home-images-first-handoff.test.ts`
  (red before, green after); local `grid-spawn-proof` before 1/3 desktop green, after 6/6 (desktop and phone, Nalati, Sky Reach,
  Driftwood).
