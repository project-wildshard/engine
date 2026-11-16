# NB8: the phone slab cut drops specks, not thin lines (mini-nb8g)

- The old probe's same-instant A/B read the game's multisampled scene target back stale and reported 0 px at any angle. A
  fixed one (a fresh single-sample target, base drawn again reads 0 px) showed the 0.001 rad thickness cut (`c8bb3817`)
  dropped cables across a sign, the tree's ribbons and the gate's trim on Nine's phone spawn: ~2.1 k px against the
  whole chunk.
- `slabRanges.ts` now ranks a leaf's triangles by their longest edge (`SlabRanges.size`), so only triangles short every way
  go: 22 px at spawn. Spawn triangles 0.76 to 0.84 M on the candidate Nine; draws unchanged.
