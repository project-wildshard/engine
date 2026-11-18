# Trail bones follow the root path (opus-of-m4, ONE-FORMAT CC22)

- `src/shared/engine/entities/trailBones.ts`: the serpent's body law. A ring of root samples, pushed on 10 Hz sim ticks
  on both sides (`trailSampleDue`), and a pose that puts bone i at i x spacing back along root -> newest -> oldest.
- First cut chained bones by straight-line distance over a distance-filtered ring. On 1,000 random paths with 9 m leaps
  a page fed coarser samples was 2 to 6 m off the server: a leap folds the path back on itself, so the first sphere
  crossing jumps legs, and a distance filter drops a fold's apex on one side only. Path distance plus a shared 10 Hz
  cadence plus keeping every sample brings the page to 0.02 m (the wire's 8 mm step).
- Not here yet: the serpent contract and poser (CC23) wire this into creatures; root interpolation stays NET-LAG's.
