# Phone Low turns on the shader cache and the idle HUD release

The iPhone 13 dies mid-load on Pine, Nine and Sky Reach (meta
`docs/plans/MULTI-REPO-SAGA/MEMORY-SAGA/iphone13/`). Two memory wins sat
on main behind device switches that were off by default: STR35's shader
source cache (`debug.cacheShaderSources`, 877fb069) and STR31's idle HUD
release (`debug.releaseIdleHud`, 89b5b67f). The mini coordinator decided
at about 03:25 Cancún, with Jake asleep, to turn both on for phone Low
if the proof held. The decision is logged in meta
QA-FEEDBACK-2026-11-19-mini row 11 for Jake's morning review. IP30's
phone budget (`debug.phoneBudget`) stays off, because Nine cut only 33 MB
against its 200 MB line.

When a switch is unset, it now follows phone Low: on in Low and off in
High. Desktop never reads it. `false` keeps the old path for one release,
and `true` forces the switch on.

## The fix the measurement found

On the cache as landed, a warm Pine boot read +144 MB of loading [K]
(two pairs, +75 and +212) and 0.17 s slower to control. A replayed
finishing request returned before it joined the in-memory finished map.
Pine's 231 finishing requests (26 programs) therefore each re-hashed
their roughly 71 chunks, which came to about 16k JavaScript SHA-256
calls. Chunk keys are now memoized per chunk text, and replayed text
joins the finished map, so a program's next request is a lookup. That
is the same path a boot takes when it emits the text. Afterwards a warm
Pine boot reports 26 finishing hits, down from 231.

## Readings

These are locked pairs: WebKit, phone Low, online, n = 3 per arm, an
8 s idle and a 20 s walk. Every arm used the same build. Off sets both
switches false. Warm leaves them unset and has the previous visit's
book. Cold is a first visit.

| Zone | Loading peak, warm (cold) | GPU settled | Ready, warm |
|---|---:|---:|---:|
| Nine | +21 (+2) MB, 1/3 lower | +2 MB | −0.07 s |
| Pine | −15 (−15) MB, 3/3 lower | −17 MB, 3/3 lower | −0.22 s, 3/3 lower |
| Driftwood | −54 (−30) MB, 3/3 lower | −18 MB, 3/3 lower | −0.01 s |

Each cell is the paired median of on minus off. With STR31 alone,
Driftwood measured GPU −18 MB (3/3) and settled −110 MB (3/3). Early-play
and walk peaks follow WebKit's collection timing (Driftwood's off arm
ranged from 1,362 to 1,707 MB), so they are reported but not judged.

## Correctness and look

- `shader-source-store.test.ts`: a build A book is never served on
  build B, and a damaged checksum is ignored. A mutation check confirmed
  it: with the build compare removed, the test fails.
- In the browser, a Nine book stamped with an older build replayed zero
  lowerings, emitted all 47 and rendered the same.
- `glsl-identity` stayed green, including its replay arm.
- STR31 was checked by hand on Pine and Driftwood. Each idle quest
  reward, talk card and shop is `visibility: hidden` and becomes
  `visible` the moment `.show` lands.
- Two blind Opus look boards (J430) found no visible change. Board 2 had
  two off-against-off calibration pairs, and its pixel differences
  matched that noise floor.

Raw data is in `tmp/mini-phone-defaults/` on the mini.
