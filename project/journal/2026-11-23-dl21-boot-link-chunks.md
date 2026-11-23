# DL21b: boot shader links in named chunks (opus-phone1)

- On the iPhone Simulator a boot warm-up's links never report one by one: Nine Dragon's 61 entry programs sat on
  'Link 61 shader programs' for 3.6 s, then all landed together, so the card stood still.
- `runPrecompile` under a loading card (parallel links, no live pacing, a progress listener, no presented frame) now
  waits for its links every `BOOT_LINK_CHUNK` (8) programs as it issues them, each wait named by its range
  ('Link shader programs 9–16'); Phase A then finds them linked. Nine: Shaders no longer on the still list (two runs).
- The bar's own share barely moves in that phase (the issue loop reports jobs over jobs + 1 + textures, already near
  1), so the moving part is the named wait; a later row could weight link units into the step's fraction.
