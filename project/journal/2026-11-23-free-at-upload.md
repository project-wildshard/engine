# Free at upload (QA 11-23-b row 17, opus-mem17)

- 86a61bf34 (opus-sdkqa) detaches a released CPU copy's buffer at its GPU upload. Detached inside three's upload callback,
  it emptied every Float32 channel vertexPack.ts defers to the next vertexAttribPointer or the task's microtask flush: the
  road deck, road tiles and Pine's ground drew nothing on the board (found with a probe that logs uploads of detached
  views). The detach now runs in a microtask queued by the callback, after vertexPack's deferred upload.
- Unforced WebKit road walk (local world rig, 402x874, Driftwood to Pine, Dunes, Sky Reach), WebContent footprint peak:
  before 2.08 GB, after 1.80 GB. Attributed RAM at Sky Reach halves (1.09 to 0.65 GB); the rest of the climb is garbage
  that is not ArrayBuffers, which JSC still collects late.
