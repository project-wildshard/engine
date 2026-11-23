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
