# STR20: five more frame allocators

> Written by: Claude (lane mini-memstruct-m3b)
>
> **State** · built 2026-11-18 on `plan/memstruct-m3b`, for MEMORY-STRUCTURE STR20 (the walk's allocation rate).

Chromium [S] owner profiles of the STR18 walk, on Nine (6.94 MB/s
after the AAC fix) and Pine (16.10 MB/s), named these:

- **The portable sine.** `portableMath` reduces every sin and cos over
  pi/4 with `reduced`, which returned a fresh `[n, hi, lo]` array. Every
  animal pose (`poseIdle`, `poseGait`), every Euler-to-quaternion and
  every sim sine paid it: about 1.5 MB/s on Pine. It now returns `n` and
  leaves hi and lo in two module numbers. The bits are the same
  (`test/portable-math.test.ts`).
- **The ground-contact disc's two passes.** A transparent DoubleSide
  material is drawn twice by three, which flips `side` and sets
  `needsUpdate` each pass, so `getProgram` rebuilt its parameters twice
  a draw every frame (Nine's `getParameters`, ~0.4 MB/s). The disc's
  material is `forceSinglePass`; it is a flat decal, so the back pass
  drew nothing.
- **Creature contact rows.** `showRows` built a row object and a body
  shape per nearby creature per frame; the rows come from a module pool
  and the shape is cached per body.
- **gpuLabels' sweep** rebuilt a node's path string and label every
  refresh window even when the node kept its label; it now skips
  labelled nodes as `tree` does.
- **The owner block.** `NetClient.owner(frame)` decoded a fresh object
  per call, and several systems call it every frame; it is decoded once
  per frame (frames are immutable once held).

Rates before and after: meta
`docs/plans/engine-memory/walk-peak-2026-11-18.md` and the STR20 row.
