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

Not fixed here: the first real world frame (`worldFrame`'s hidden frame) costs 0.3-0.6 s of read-back on most builds and
2.0-2.4 s on some, base code included; the same frame's passes drawn just before it, fenced, took 26-223 ms each, and the
uploads in it are under 0.5 MB, so its cost is not in our draws.
