# DL21b: boot shader links in named chunks (opus-phone1)

- On the iPhone Simulator a boot warm-up's links never report one by one: Nine Dragon's 61 entry programs sat on
  'Link 61 shader programs' for 3.6 s, then all landed together, so the card stood still.
- `runPrecompile` under a loading card (parallel links, no live pacing, a progress listener, no presented frame) now
  waits for its links every `BOOT_LINK_CHUNK` (8) programs as it issues them, each wait named by its range
  ('Link shader programs 9–16'); Phase A then finds them linked. Nine: Shaders no longer on the still list (two runs).
- The bar's own share barely moves in that phase (the issue loop reports jobs over jobs + 1 + textures, already near
  1), so the moving part is the named wait; a later row could weight link units into the step's fraction.

## DL21c: the fresh-page swap

- Page clocks on the Simulator (Nine, load 11): the title leaves ~0.3 s after ENTER WORLD, the `/leave` document starts at
  0.35 s and the game document at 0.8 s; the inline shell card paints soon after. The recorder cannot poll the leave page
  and re-attaches to the new page 0.3 to 0.6 s after it starts, so its 1.1 to 2.6 s "still" across the swap is mostly
  its own blind spot, and grows with Mac load (none at load 11, 1.1 to 1.4 s at 20 to 50).
- What the card itself lacked: before Loading adopts the spawn download, `paintSpawnDownload` filled the download bar but
  left the foot empty, so the first 2 to 3.5 s of the new page read as an unnamed step. It now names 'Spawn download ·
  N / M files' until the download closes.
- The recorder now reads each page's first contentful paint (`fcp`), and the analyser counts a fresh document's
  inline card as painted then (`withFirstPaints`), not when the inspector meets it 0.3 to 0.6 s later. WebKit reports
  the game page's paint ~40 ms after its origin.
- Proof, all three DL21 commits, Nine packs on the Simulator at load 12 to 23: cold 12.1 s and warm 8.4 s to control,
  no card still for a second and no unnamed step (the first pair, before `fcp`, read only the 1.2 to 1.3 s swap).

## Follow-ups (opus-phone1, 03:00 to 04:00 Cancún)

- The isolated warm-up path under the card (a home region's) now chunks its links too; `precompile-link-count.test.ts`
  asserted the old counted-behind-a-resolve behaviour and now asserts the chunk.
- A fixed 8 still took 1.0 s on Sky Reach; a fixed 4 cost Pine's cold boot 2.6 s in waits. Chunks are now sized from the
  last one (`LINK_CHUNK_TARGET_MS` 500, 2 to 16, at most 1.5x the last), first 8.
- Signal Dunes' home tiles held the card 1.4 to 1.7 s on 'native presentation tiles' while they uploaded one a frame;
  the boot ring pump (`stepRingsUntil`) now counts each upload on a 'Home tiles · N uploaded' wait.
- DL24 (play's first second): Pine's 21 to 23 fps for 4 s after control is the grid outer ring's preparation (measures
  `outer-ring.strips`/`road`, 0.5 to 4.6 s after control); no play frame over 250 ms. Its pacing is iPhone 13-tuned
  (`outerPaced.ts`, `OUTER_RING_SLICE_MS`), left alone.
- The home tiles count landed as its own commit (loadingRings.ts, session.ts's `uploads` port).
