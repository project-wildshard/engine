# LS11: pace shader work on a serial GPU

> Written by: Claude

LS8 left headless SwiftShader (no KHR_parallel_shader_compile, `serial`) with one 2.0-2.6 s bar stall a run. Measured on
Driftwood, strict, 4x CPU, with a main-thread heartbeat and a Chrome trace:

- Shaders step: 123 jobs issued in 0.2 s, then the first link query (`GetProgramiv`) held the main thread 0.74 s while
  the GPU process linked all 75 programs, and the step's total grew by 75 programs, so the bar held its earned share
  through them. After the two post draws the canvas read-back (`ReadPixels` -> `ContextVk::finishImpl`) held it 1.1 s
  more behind the 19 texture uploads and both post pipelines.
- First frame: the first full view after the 264 world slices cost one 1.3-1.9 s GPU unit (fenced), though the same
  draws took 45 ms again and every drawable's pipeline was already built in its slice. Drawn first as six growing
  prefixes of its draw order the units were 0.15-0.56 s and the full view after them 42 ms; drawing the same objects in
  arbitrary groups did not help (the full view still paid 1.3-1.8 s after them).

Changes, all for a serial GPU under a loading screen (`presenting()` false) or a first frame the shaders step measured
slow (`narrow`); Metal Chromium and WebKit take none of them:

- `runPrecompile` resolves each job's new programs inside its own slice, so the slice clock counts the link.
- Image uploads and the boot's post draws each wait for a fence (asked once a paint, never waited on) before the next.
- `Game.firstViewParts` draws the first full view as six fenced prefixes, weighed 0.33 s each.

The first real world frame (`worldFrame`'s hidden frame) then held the page 2.0-2.4 s on some builds (base code too),
in the step after it. Not our draws: the same passes drawn just before it, fenced, took 26-223 ms each. It was Chrome's
software compositing: a frame that shows a freshly drawn WebGL canvas reads it back on the main thread (`ReadPixels` ->
`ContextVk::finishImpl`). With every canvas hidden the run had no main-thread hold at all and no stall. So on a GPU the
shaders step measured slow, `Loading.coverCanvas` hides the world's canvas under the card and puts it back as the card
starts to fade (or is disposed).

Review (Codex, J206): `gpuSettled` now rejects a lost context or a failed fence wait with `FenceAbortError`, as the first
frame's fences do, and the first-view prefixes order opaque drawables by `gltfOpaqueSort`'s key (render order, material
file batch, declaration index; `opaqueMaterialOrder`).
