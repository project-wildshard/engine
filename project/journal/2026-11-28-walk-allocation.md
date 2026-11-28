# 2026-11-28: what raised Nine's walk rate

- Meta QA 11-26 row 81: Nine's online walk allocated 19.4 MB/s [S] on main, against a 3.56 MB/s baseline from 11-19. The
  hosted readings stayed at 2.4 to 4.0 MB/s through e02a796fb (11-26). Then efed7f5a6 changed how the walk boots: it
  enters Nine's one-cell grid world (`alone`) and no longer enters by the old chunk address. The grid world places about 190 to 250
  InstancedCull views, and walking tests about 290k copies a second. A MacBook run of 0749ecbde read 19.41 MB/s
  (18.09 to 20.06), the same as hosted.
- I patched the pinned client and measured each change. That gave two allocators that run on every call:
  - The culler's `View.sees` copied each tested copy's sphere into a held `expanded` sphere, grew its radius and passed
    that to `Frustum.intersectsSphere`. That was 4.2 to 4.6 MB/s, charged to `level` (cull.ts:423). Removing only the
    copy and grow took `level` off the list. Removing the cascade-shadow loop or the `center.set` did not. The fix
    tests the six planes in place, with the grown radius held in a local.
  - The environment fold rebuilt its argument list for every draw
    (`Reflect.apply(call, renderer, [scene, camera, ...])`): 2.3 to 2.6 MB/s. Now it passes the call straight through.
- After the fix, walk-ci on a MacBook preview build read 13.17, 14.54 and 15.65 MB/s (median 14.54), and the culler fell
  from 6.0 to 1.2 MB/s. What is left is the grid world being drawn: three's render inlined into the fold (about 2.2),
  `updateMatrixWorld` (2.0), the culler's `changed` (1.1), uniform writes and draw hooks. The chunk-boot baseline never
  drew that. So the new baseline comes from a hosted run after this fix, recorded under efed7f5a6's grid-world walk.
- Guard: test/walk-allocation-sites.test.mjs fails if `View.sees` copies or writes a field again, or if the fold builds an
  argument list again. Both fold functions are tagged `@frame`, so the frame-allocation lint covers them. walk-ci holds
  the rate.
