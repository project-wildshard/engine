# VITEST-BENCH VB9: which happy-dom files are really DOM-free

Plan: meta `docs/plans/VITEST-BENCH-PLAN.md`, row VB9: move the `dom`
project's files that touch no DOM API to the `node` project.

Of the 132 runnable happy-dom files, 32 pass with identical results when
run under `node`. That alone does not make them DOM-free: three.js loaders
and many product modules read `document` or `navigator` behind a `typeof`
guard, so under `node` they quietly take the other branch.

So the test for "touches no DOM API" is stricter: run each file under
happy-dom with `document`, `navigator`, the canvas and image elements, the
observers, `matchMedia`, `requestAnimationFrame` and the rest turned into
getters that throw (installed after the shared setup). A file qualifies only
if it passes like that and also passes under `node`. Five do:
`fixture-product-schema`, `net-loot-feed`, `title-prefetch`,
`diagnostics-summary` and `loading-packs`. `built-product-dom` passes under
`node` too, but it exists to prove the DOM suites can read CI products, so
it stays. The other 26 read a DOM global somewhere and stay where they are.

Measured at one worker, three rounds: the five cost 3.9–4.1 CPU-s under
happy-dom and 2.8–3.7 under node, about 0.2 CPU-s a file. Small, as the
`environment 1%` line of every gate log already said.
