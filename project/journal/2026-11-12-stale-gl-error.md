# A stale GL error no longer fails a texture upload (opus-tex1, 2026-11-12)

- The v0.1.13 staging check (b3e9a56b, headless Chromium) saw "Driftwood Isle could not load": Graphics error 1281 before
  compressed texture shardfile:a3fca362 (#83, Driftwood's first KTX2, 1024x1024), at finish.
- The texture was a bystander. Each failing boot first logs a burst of `GL_INVALID_VALUE: glGetProgramiv: Program object
  expected`: a program query on a program that no longer exists. `uploadCompressedTexture` reads `getError` before its
  upload and failed on that leftover flag. It is intermittent: about 2 in 17 staging boots, only in a browser that has
  already booted a shard. No texture, KTX2, pin or retirement code changed between v0.1.12 and v0.1.13; the
  flake most likely predates v0.1.13. The opus-rel13 rerun of the same check passed.
- Fix: ES 3.0 §2.5 says a command that raises any error except OUT_OF_MEMORY has no effect. A flag left by an earlier
  call therefore touched nothing the upload uses. The upload now drains the queue (with `clearCreationErrors`, the E7.9
  helper), records a `texture:stale-gl-error` checkpoint and warns. It still fails on out of memory or a lost context, and
  on any error the upload itself raises.
- Still open: the program query's caller has not been found yet; it never fired under a JS spy. GC15c's "a3fca362 lost its
  allocation after mip retirement" on a crossing is a different path (a retired texture re-bound after its allocation
  changed), not this one.
