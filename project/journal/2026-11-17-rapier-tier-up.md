# Rapier's one big compile (ENGINE-MEMORY EM21)

> Written by: Claude (lane mini-em21)

EM21 had one item left: Sky Reach's `world` checkpoint in the Chromium microscope showed `v8/workers/malloc` 156 MB and
`v8/main/malloc` 59 MB [R], gone by `loadout`. It is one optimizing compile, and most of the dump's number is that compile
counted more than once.

**What it is.** V8's `--trace-wasm-compilation-times` in node (same V8 family as Chromium, same `rapier.wasm`) names it:
`#2643 using TurboFan, took 325-438 ms and 190,668,056 max zone bytes; bodysize 366104`. Rapier 0.21's step pipeline is
one 366 kB wasm function (the module's code is 3.1 MB in 2,897 functions; the next largest are 101 kB and 81 kB). V8
optimizes it on the second `world.step()`: stepping an empty world twice is enough, and the warm-up's length does not
matter (10 ms or 240 ms, the same 199 MB peak). The other large compiles in the warm-up are #359 (35 MB) and #29 (18 MB);
Liftoff's lazy first compile of #2643 is 49 MB on the calling thread for 12 ms.

**Why the dump says 156 + 59.** V8 adds its process-wide wasm engine allocator (where wasm compile zones live) to every
isolate's `malloced_memory`, and Chromium's memory-infra writes that per isolate. At `world` the page and two worker
isolates each reported it: main 125 + workers 250 MB [R] against a real `malloc/partitions` rise of 155 MB (241 against
86 with `--liftoff-only`). Read `v8/*/malloc` during a wasm compile as one number per isolate, not a sum.

**Where it lands.** In Chromium the compile runs inside the `world` step, from the server worker's warm-up (`69d4b822`),
and is freed before `loadout`. Sky Reach, phone Low, headless Chromium, one run per arm on build `ee508f6c`:

| Arm | `world` renderer [R] | malloc partitions at `world` | Highest checkpoint [R] |
|---|---:|---:|---:|
| Base (two runs) | 429, 454 | 226, 241 | 523 / 512 (`gameplay`) |
| `--js-flags=--liftoff-only` | 284 | 86 | 521 (`shaders`) |

The loading peak is the zone's own work at `gameplay` and `shaders`, the same with and without the compile, so the
compile is already transient and off the peak. The 60 MB [R] line in EM21's done-when cannot be met from engine code:
the compile's size is the function's size. Only a Rapier build whose step is not one 366 kB function would cut it.
JavaScriptCore, the phone's engine, shows no such cost. EM13 found none on Template; on Sky Reach, native WebKit [K], 4
alternating cold runs on `ee508f6c`, base against `JSC_useOMGJIT=false` (set in the launch environment; not read back
from WebContent): WebContent peak median 863 MB (841-870) against 869 (862-896), `world` peak 844 against 845, settled 613
against 619. Turning JavaScriptCore's optimizing tier off does not lower the peak, so the phone does not pay this compile.

**What guards it.** `test/rapier-tier-up.test.ts` watches `malloced_memory` (which includes the wasm engine) in a fresh
worker: after `warmRapier`, a game-shaped world (heightfield, convex hulls, cylinders, a joint, a character controller,
ray and shape casts, 240 steps) must raise it under 32 MB. Three runs: warm-up 183-195 MB, play 0.0 MB. With the warm-up
removed the same test fails at 183 MB, so a Rapier upgrade or a warm-up change that pushes a large compile into play
(onto the first frame, the pre-`69d4b822` peak) is caught.
