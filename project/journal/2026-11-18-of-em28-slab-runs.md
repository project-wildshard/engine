# OF-EM28: smaller Nine slab buffers on the phone (opus-of-em28)

- OF-EM28a: the phone's NB8 slab merge now caps a run at 65,535 vertices
  (`slabMergeRuns`, tier knob `slabMergeVertices`), so every run keeps a
  16-bit index. Nine's chunks are 51-55 k vertices (the cook's 4 MB cap),
  so each run is one chunk: the key draws per chunk and no merge copy is
  made. Measured three options (merged u32, split u16, 65,535 runs) in
  headless WebKit phone Low; the last two are byte- and draw-identical on
  Nine. Ledger WebGL buffers 124.33 -> 117.41 MB, WebContent peak median
  1,837 -> 1,520 MB (3 alternating cold boots, load 25-32), draws +12-19
  at fixed cameras, frame times unchanged. The surprise: the peak cut is
  the merge copy (every channel of a 60 MB key copied beside its chunks),
  not the index width.
- Watch for OF-EM28b/c: once vertices shrink, a 4 MB chunk passes 65,535
  vertices and its own index goes 32-bit; the cook should cap a chunk at
  65,535 vertices too.
