# The ArrayBuffer census is retired (QA 11-25 row 81)

> Written by: Claude (opus-chunk3)

`scripts/memory/census.mjs` (ENGINE-MEMORY EM6) timed out at control, both before and after CHUNK-PARAM CP17. To find
why, I booted Pine Hollow twice on a local preview build of main. Without the census's init script, it reached control
in 15 s. With it, the page logged `[trees] the rest geometry pool did not load: THREE.MathUtils: Invalid component
type` and stayed on the loading card at the `gap` step for four minutes. The init script wraps the typed-array
constructors, so a wrapped array's `constructor` no longer matches the check three.js uses to read normalized
attributes. The microscope broke the game it measured.

No CI job, budget, skill, doc or release check reads the census's report, and ENGINE-MEMORY closed under J472. So it is
retired rather than repaired: the script, its types and its unit test are deleted, and the two comments that pointed at
it are reworded. The page's `__wildshardMemory.owner` hook stays, because other memory probes share that hook.
