# Nine Dragon Stack: runtime-owned item rows (SF51-p, E435)

The committed fragment has one Neon Jian and one Fei Zhua. Its quests, fauna, encounters and mutable shard state are empty (its two ledger feats came later, G285, below); this conversion does not create new gameplay or migrations for absent state.

`shard.config.ts` declares both items and binds `items` to the trusted runtime. The runtime adopts the existing prebuilt Sword and constructs the grapple at the original play-stage point, then installs it once. The Jian retains its native `sword` compatibility slot; the grapple retains `tool.fei-zhua`, LOCK/JUMP input and its native offhand policy. The runtime-owned tool has `action: null`, so the data installer creates no second toggle binding.

G51 recipes retained: native Sword contacts/viewmodel; Fei Zhua targeting, rope, pull and traversal; checked deck portals; fragment geometry, decorative crowd and light/renderer/FX controllers. No decorative object is represented as an Animal spawn.

Validation: row/UI/cue/metadata equality, native input ownership, direct-installer refusal and C26 byte-preserving reload fixtures; existing plugin, Jian and Fei Zhua contracts. Clean strict, typed lint and ratchet pass. The full clean-export suite passed 955 files / 5,439 tests, with 14 skipped (255.27 s, bounded four-worker run through heavy-lane ticket 463); all 17 focused fragment contracts passed. The real standalone/grid browser proof follows below.

The isolated candidate excludes the uncommitted SDK migration in plugin.ts/world/jian.ts/vm files. Its map is rebaked from the clean candidate, never the shared working tree.

Browser pin: `402b87c9f7ee13cd178349be9132ecc91019f986`, official DEVSERVER build, one wrapped muted Chromium browser with iPhone 16 Pro, phone tier and Developer ON. Standalone entered play with native `sword` / declared `weapon.jian` and `tool.fei-zhua`, native LOCK/JUMP, no page errors or error reports.

Grid proof at this SF51-p pin is explicitly **not green**. Two real held-input attempts stopped at world z≈−298.35 (Nine north cell edge is −305), behind the waiting screen / soft wall, with no error reports. A direct home-to-Nine pose was correctly refused by the neutral-road ownership fence. The corrected road-first pose reached `(555, 0.5, −315)` and exposed the existing refusal: `nine-dragon-stack is not a shardfile shard (it stays a far proxy until M3)`. No Nine runtime or item installer ran. The coordinator accepted this as an SF51-g admission / midpoint-entry gap; the item conversion does not bypass it. Every failed attempt is preserved beside the successful standalone phase.

The later [SF51-g admission proof](grid-admission.md) closes that descriptor/runtime gate and crosses the north readiness wall by real held movement. It preserves these original failures and states the limits of the new claim.

Map: rebuilt after the Nine map-style commit `f9a2e7493`, using the official `scripts/bake-maps.mjs` command from the clean candidate. The stamp is `c9c32e3ef2792cfc2afee6d6bd73a15c25b56d33042115a03bf28c4ff9060d5c`, stylized ground, 1,000 px / 13,488 bytes. The browser proof pin predates this map-only rebake; the native world / layout inputs are unchanged.

## SF72 witness (parts 2–5): what `compatible: true` covers, and what it does not

`run.mjs` runs the generated renderer-free map `tmp/headless-modules/nine-dragon-stack/modules.mjs` through the platform's own trusted adapter
(`createTrustedHeadlessAdapter`). The result is **compatible** (`transitional: false` in `compatibility.json`): no
renderer-bound system decides a gameplay outcome. Decorative crowd, light and view controllers remain trusted
runtime presentation.

The ordered calls now come from `data/headlessAssembly.json` and the checked
native module map. `generators/headless.ts` admits the original collision bake,
removes the standalone caps and expands treads with the engine's own law. The
product owns those collider rows and hook coordinates; the installed Jian,
portal ride and grapple keep their original clocks and snapshot adapters.
The witness fingerprints both emitted assembly blobs as well as its modules.

The [proof extraction audit](../../../progress/shard-platform/honest-floor-2026-10-17/proof-build-reach.json)
compares the same native tape before and after module-map generation. Both
runs report zero entry-admission lanes, steps and transfers for the current
admitted product; the historical 92-lane entry claim below is not current
coverage. Both tape-driven portal rides, grapple, replay and ledger results
are unchanged. The extracted proof definitions match the parent byte for
byte; this refactor adds no entry coverage.

**Runs headless (proven):**
- the native colliders of the grid cell (`generators/physics.ts`, called directly from authored rows, G350-ND / GR3):
  the fragment at +125 m, the four landing decks open to the road (the standalone end caps removed), the square's slab,
  the Well's crossings and safety cap, every placed model's colliders;
- the player capsule walking them from the declared spawn, by tick commands;
- the Jian as declared swept rows on `game/plugin/nativeItems` and the shared `SweptMeleeCore` clock (also used by Driftwood):
  combo, one-deep queue, combo gap, cooldown and active windows, with exact continuation (the ride replay restores mid-swing);
- the portal-link entry proof (`provePortalLinks`): 23 capsule lanes per deck and the format's checked transfer to the
  square and back (92 lanes, 8 transfers);
- play-time portal rides (part 3) on the page's own ride, `world/portalRide.ts` (renderer-free since the fade veil moved
  to `world/portalVeil.ts`), driven by the declared portal assembly after the player's move: the tape walks the square's declared
  route from the spawn into the ring out (→ the north deck, `portal.square.north>portal.north`), steps 2.5 m out of the
  deck's ring and back in (→ the square, `portal.north>portal.square.arrival`). The hold is the page Player's `carried`
  (feet kept at the ring's touch through the fade), the transfer is `createPortalTraversal` on the host's own physics,
  motor and feet; the ride's state and hold are continuation, and the committed ride checkpoint (tick 464) falls mid-swing AND
  held in the square's ring before the transfer. Its 60-tick suffix finishes the north transfer. The same build's browser rides all four decks (north arrival
  (0, 0.01, 236), the headless one (0, 0, 236));
- the Jian's charged heavy (part 5) on the tick protocol's HEAVY hold: back at the arrival the tape holds HEAVY for 40
  ticks and lets go, one heavy swing on the same clock (22 swings in all);
- the Fei Zhua (parts 4–5) on the page's own law: `grapple/sim.ts` is renderer-free (targeting by the view's projection,
  reach, sight past the Well's rail, the landing test, fire → bite → lift → zip → vault → settle, or a miss reeled back,
  with snapshot / restore); the page's `grapple/FeiZhua.ts` drives it and draws the rope, markers and FX, and the host's
  `runtime/grapple.ts` drives it from tick commands (a LOCK script press, the aim's pitch as a script value, the player
  command's JUMP), on the 31 dragon hooks the physics product records (`hooks`, authored in `data/physicsRows.json`). The aim is
  the player's eye at the command's heading and pitch projected as the phone's portrait camera, so the hook nearest the
  screen's centre is the one the claw takes, as on the page. `headless-runtime.test.ts` also zips onto the east tower's
  ledge from the arrival and restores mid-zip byte-exactly;
- the Well crossing (part 5, gates / fragments): after the heavy the tape walks 6 m south along the square's west
  balustrade (x 0.2, 1.1 m high), jumps it onto the Well's south rim (z 11.2…16) and fires north across the Well at the
  crossing's hook (−8.2, 121.37, −18.49), seen past the rim's rail and the safety cap. The zip lifts over the rim's
  parapet with the cap's baked colliders (`nds-grapple-guard`) switched off exactly while the lifting crossing flies
  (the page's `NdRuntime.guardOpen`; 151 ticks), lands on the crossing's deck at (−8.53, 119.09, −20.67) and the cap
  closes behind it. `headless-runtime.test.ts` restores mid-crossing with the cap open (still open on the fresh host,
  closed on both after the settle). The see-past rule reads the host's collider owners, which are piece ids (strings,
  snapshot-safe) where the page's are the piece objects; before part 5 the host could never see a hook past the rail.

**Not applicable:** Jian contacts on real targets. Nine has no creatures, so each active window fires the declared
zero-damage contact at nothing. The combo, heavy and contact clock are still exercised. This is not an open gameplay
item and does not make the witness transitional.

**Ledger from gameplay (G285).** Nine declares two feats as ledger rows (`data/ledger.ts`, bound to the runtime):
`nine-dragon-stack.lantern-square` (a deck's portal rides you into Lantern Square, origin `engine.portal.ride`) and
`nine-dragon-stack.well` (the Fei Zhua's lifting crossing settles over the Well, origin `engine.fei-zhua.crossing`).
`world/feats.ts` reads both off the same laws the page and the host run (the ride's transfers, the grapple's settle →
release); the page sends them to `bindRuntimeLedger` (`runtime/facts.ts`), the host emits them as committed `fact`
effects. The ledger stage plays the whole tape: the ride home lands in the square (tick 587) and the crossing settles
(tick 1086); both facts reach the platform `Ledger` once under their declared provenance, durably, and a session restored
from the tape's end plays 120 more ticks and re-emits nothing. A zip that is blocked or times out releases from the zip,
never the settle, so it reports nothing. The checkpoint payloads are unchanged (no new continuation state).

## Short replay checkpoints (Nine6)

The uninterrupted headless stage still walks all 1,149 ticks, exercises both portal rides and the charged heavy, crosses
the Well, and proves 92 entry lanes / 8 transfers. Replay no longer repeats that whole tape:

| Checkpoint | State | Suffix | Ticks stepped in both continuations |
| --- | --- | ---: | ---: |
| `ride` (400) | Jian swing 1, held in the square ring before transfer | 60 | 120 |
| `crossing` (940) | Lifting zip across the Well, safety cap open | 144 | 288 |

Each test owns one generated checkpoint, checks exact canonical restoration, then runs two fresh adapters' short
suffixes. The shipping `HeadlessSimulation` worker restores the same checkpoint and executes the entire suffix:
60 ticks through the portal transfer, or 144 ticks through the Well crossing's settle. Every worker tick must match
the in-process canonical state and committed effects. No native transcendental-dependent terminal digest
is used as a cross-platform oracle. The aggregate replay steps **408 ticks**, down from 1,768 (77% fewer); headless
coverage is unchanged. Separate tests keep the portal / sword and Well continuation assertions, each with a 60 s budget.

`checkpoints/manifest.json` records the SHA256 of every loaded repository module (including the command tape, trusted
entry, engine simulation / snapshot / player / physics closure and imported physics bake) plus Rapier WASM. The native
CLI admits the same closure in each mode; `fresh` and every replay refuse stale inputs before restoring. The checkpoint
wire is strictly parsed and the engine validates the packed snapshot. Regenerate explicitly from a clean candidate:

```sh
node --import ./scripts/sim-node-loader.mjs test/proof/nine-dragon-stack/run.mjs checkpoints
node --import ./scripts/sim-node-loader.mjs test/proof/nine-dragon-stack/run.mjs fresh
node --import ./scripts/sim-node-loader.mjs test/proof/nine-dragon-stack/run.mjs all
```

`compatibility.json` is re-recorded from the real `all` run, with canonical hashes. Engine or Nine closure changes need
a checkpoint regeneration just as Sky's committed checkpoints do. No production source, collider or map input changes
in this slice.

The isolated local coverage check (`vitest run .../headless.test.ts .../replay.test.ts --coverage --maxWorkers=1`,
heavy-lane ticket 989, queue excluded) took 8.002 s for the whole headless route, 1.206 s for the ride replay and
2.349 s for the crossing replay. Each is below one third of its 60 s timeout. A separate independent-process
determinism check passed both slices under coverage (8.108 / 14.019 s while the shared machine was busy).

## Why the hook debug capture remains

`grapple/course.ts` contains interfaces, not hook placement data. The 31 ring centres are emitted by `square.ts`,
`towers.ts`, `stairstreet.ts`, `stairstreet-upper.ts`, `well-rim.ts`, `well-mid.ts` and `well-bridges.ts`. Their render
builders combine wall profiles, geometry placement and seeded detail generation; the timber pavilion's hook depends
on its RNG-selected / clearance-adjusted pavilion centre and LOD. `props.ts::dragonHook` records the final ring centre
while drawing its geometry; the stair-foot dragon records a separate transformed jaw ring.

A faithful Node derivation requires extracting those authored placement recipes and their shared random choices into
pure data used by both the render builders and the bake. Copying the 31 baked coordinates would only duplicate the
bake, and importing the builders would load the renderer. This follow-up therefore retains `nd.grapple`, the real
browser bake, and Nine's `context.debug` cap of 2. The placement extraction remains explicitly open; it changes world
map inputs and needs a browser-equivalence proof and map rebake.

## G350-ND: authored physics (was DS1.5 Node canonical)

`generators/physics.ts` composes the physics product directly from authoring inputs only (G320 / GR3):
the floor, front, portal and guard recipes (`generators/physicsPlacements.ts`) and `data/physicsRows.json` for what no
recipe computes yet (the placed models' colliders, the Well's crossings, the practice arena, the registry order of every
piece and the Fei Zhua's 31 dragon hooks). It runs under the authoring loader; no world, model, registry or runtime code
runs. The retired DS1.5 bake built the world in Node; its last output matched this product in every piece and hook, byte
for byte. The source-row regression checks its complete original payload hash; the file-only job is retired.

The DS1.5 history below is kept as the record of how those bytes were first proven.

The deliberate re-record changes five pavilion collider yaws from `2.7755575615628914e-17` to
`5.551115123125783e-17` radians: maximum absolute difference **2.7755575615628914e-17 rad**.
All other fields in the 23 pieces / 489 colliders / 31 hooks are exact. Shipping recipe arithmetic is unchanged; no
quantization was introduced. Two independent Node runs write byte-identical outputs. The fresh browser comparison
confirms exactly these five differences, and the officially rebaked map image is byte-identical.

The tick-400 and tick-940 checkpoint re-record changes only native physics chunk bytes/checksums; every decoded
non-physics field and every route, attack and earned-ledger outcome is unchanged. Restore and the actual SDK worker
match the complete 60/144-tick suffixes. Checkpoint payloads remain in the generation cache; only their small manifest
is recorded. `compatible: true` remains backed by the real gameplay run.

The official `physics-baseline.mjs --no-build --mode=walk --shard=nine-dragon-stack` run on the DEVSERVER candidate
passed **19 legs, 0 stuck, 0 page errors**, including walking, stairs, Well crossings and containment/hover legs.
The boolean Developer fixture is now stored and compared as a boolean in that harness, rather than as a string.


SF81 DIR5 portal order: deliberately re-recorded both ride (tick400) and crossing (tick940) checkpoint hash manifests for PortalRideState version2 and the complete stage cursor. A decoded full-wire comparison proves ONLY those two added fields change; every command byte and other native field is exact. The complete shipping-worker suffixes, real two-portal journey, Jian heavy, grapple/cap continuation, all entry lanes and durable Ledger outcomes match the predecessor. Official map pixels and actual Node physics payload are exact. Older/foreign ride snapshots refuse quietly. No source gzip payload is committed.

## G504 B4: prepared LODs and entry floor rows

The static mesh simplifier and clustering implementation now run only in
`generators/`. The cast author emits 25 lossless LOD GLBs and three full dyed casts. The existing cast
library reads them at the original load phase; middle levels share every
full-detail attribute buffer and retain their independent index buffers.
The three full colourways replace the client tint function and colour
constant; their middle levels prove their native channel bytes too.
Compact far levels keep their own attributes and native bounds. Four
generated inclusive rectangles drive the existing `floorAtRects` query.
The runtime `meshLod`, `edgeDecks`, `world/floorRows` and `data/decks`
modules are deleted. The fixed-kits JSON book remains byte-identical.

At B4, a parent-generated snapshot pinned all 25 native levels' channel/index
bytes, typed storage and bounds. G919 retired that snapshot; the cast test
retains live half-float decoding, middle-level sharing, borrowing and inclusive
floor-boundary behavior instead. At B4, all 37 cast cases and all 17
shard-headless cases passed. Root/layer types, typed lint and all ten products
passed on the isolated candidate.
The integrated check also includes the six traversal contracts: 60 cases
pass in total. On admission repair `d36f4694b`, the unchanged full native
witness reports `compatible: true`: both shipping-worker continuation
suffixes (60 and 144 ticks), headless play and durable Ledger outcomes
pass. No witness or checkpoint recording is changed by B4.

The source ruler measures net -162 Nine shard lines (C1 -164, C9 +2),
with AssemblyScript +0 and platform +0 across all four layers.

The official native view proof compares the frozen eighteenth parent
`cc2178c` against the isolated B4 candidate on phone/desktop poses A/B/C:
all six pixel hashes, draws and triangle counts are exact. GPU allocation
is unchanged (phone 277,928,459 bytes; desktop 519,643,151 bytes). Both
tiers retain 23 pieces, 489 colliders and the exact collider hash. Observed
CPU backing storage rises by 13,166,004 bytes per tier; this is the real
GLB transport cost, while GPU allocation remains exact. The 28 generated
GLBs total 14,625,652 bytes before HTTP transport compression. The
official physics walk passes all 19 legs with zero stuck and zero page
errors (iPhone 16 Pro, muted Chromium, the real served candidate).

Repeated captures of unchanged build `740b8c3` also exposed capture
variability: desktop A differed at 718 pixels and B at nine, with all
other poses exact. The parent `95617e5` exhibited both historical hash
variants too. A complete repeat matches that parent on all six strict
pixel hashes and every draw/triangle/GPU/contact fact; no comparison
threshold or checkpoint recording is changed. The proof bank retains the
initial failures, matching repeat and same-build raw-difference receipt.

What stays: the small client cast reader and live per-frame culling and
motion remain counted presentation code. Nalati's analytic terrain
queries, live dressing cull/motion and dungeon hazards stay in their
existing owners; this batch changes none of their behaviour. No host,
material, gameplay rule, AssemblyScript or missing-asset fallback is added.

G490: this is a source-only landing for the twenty-first map window. The
producer declares all 28 exact GLB outputs and the generated floor book.
The map owner declares their direct input pins and performs the official
map bake plus strict all-ten closure after the ordered source landings.
