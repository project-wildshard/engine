# Stored spawn parts leave memory before the shaders step

Mini QA 2026-11-17 row 19. Jake was on his iPhone 17 Pro (Low Power Mode,
so Low graphics) on staging v0.1.36 and entered Nine. The card read
5.5 of 5.5 MB at 99%. Then iOS killed the page: "Abrupt previous page:
Nine Dragon Stack boot plan complete 73% setup / 100% download at
compile:after". It failed the same way twice. WebKit charges the page's
WebGL textures and buffers to the WebContent process, so the
pipelines and uploads made in the shaders step push the boot over the
17 Pro's ~2.05 GB line.

We took a Chromium heap snapshot at firstFrame on staging (phone tier,
DPR 1, x4). Of 267 MB of ArrayBuffer data, 106.5 MB was the spawn
download's 48 parts. They were held whole in `members` until control,
even though every member was already in the store. At worldPrograms
the parts still held 108.6 MB. Geometry arrays held 88 to 147 MB,
wasm 23 MB. Prod v0.1.35 shows the same profile (Chromium peak 705 MB
against 656 MB), and the engine diff from v0.1.35 to v0.1.36 changes
no render or memory code. This is Nine's phone boot peak, not a
regression in v0.1.36.

Change: a member the store holds leaves `members` on its first read.
Every stored member leaves before the shaders step
(`dropStoredSpawnMembers`, boot mark `download:members-dropped`).
Later reads get the store's copy, checked against the manifest
(`storedUrls`, the server worker's `spawnHeldBytes`). A member the
store refused (quota) stays in memory as before.

Before/after on the same build pair (HEAD and HEAD plus this change):
- Chromium phone tier, Nine, cold: ArrayBuffer backing at shaders went
  from 371 to 217 MB, at worldPrograms from 508 to 275 MB.
- iOS Simulator Safari (iPhone 18 Pro, iOS 27.2, Low, cold, two runs
  each): peak WebContent native footprint during load went from
  1.008 and 0.980 GB to 0.892 and 0.876 GB. Over readyFrame and
  spawnPrograms it went from 1.00 to 0.86-0.90 GB. The GPU process
  stayed at 0.23 GB.

The Simulator has no jetsam and does not charge GPU memory to the
page, so only Jake's phone can confirm the fix, after the next
release. `test/spawn-member-memory.test.ts` was red before this
change.

The same lane also made two fixes to the measuring tools:
- `sim-lane.sh` picked Xcode 27's device-only runtime
  (iOS-27-2-iPhone19-4) and failed to create `wildshard-iphone`. It now
  picks the general runtime and the newest Pro that runtime takes.
- `nine-sim-memory.mjs` now saves NAME_ASKED. Without it a run sat on
  the Name prompt until its 300 s limit.

## Follow-up: geometry CPU copies at boot

The Memory saver lets a geometry's CPU copies go 240 renders after
its first draw. The boot draws the world only a handful of times, so
under the loading card nothing was released: Nine's phone boot held
88-147 MB of attribute arrays (aFace, aMisc, aPat, aSpill, normal,
colour) beside their GPU copies through its peak.
`releaseDrawnGeometry` now releases every geometry drawn so far that
has not changed since its first draw. `finish.ts` calls it after
shaders, firstFrame, worldFrame, each readyFrame hidden frame,
spawnPrograms and worldPrograms. `position`, skins and the index stay,
as in play. A later read brings an array back from the GPU; a traced
boot made no such read.

Measured on HEAD `653c748c` against this change:
- Chromium, Nine phone load: 77.6 MB released, where none was before.
  The live heap at control (collected) went from 367 to 289.5 MB.
  Attribute arrays at spawnPrograms went from 185 to 96 MB.
- iOS Simulator, Low, cold, two runs each. Inspector peak at
  firstFrame/readyFrame went from 0.935 and 1.049 GB to 0.911 and
  0.925 GB. The whole-load native footprint went from 0.960 and 0.823
  to 0.815 and 0.848 GB. The GPU process stayed at 0.23 GB. Staging
  v0.1.36, without either cut, read 1.318 GB.

The "+240 MB at spawnPrograms" was not an allocation. A sampling
heap profile with collected objects from readyFrame to the end of
the boot saw 67 MB allocated in all. The used + backing step peaks
move 400-670 MB between runs of the same build, with GC timing.

Lane: mini-boot99
