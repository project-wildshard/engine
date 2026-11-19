# Streamed AAC makes no PCM garbage

> Written by: Claude (lane mini-memstruct-m3b)
>
> **State** · built 2026-11-18 on `plan/memstruct-m3b`, for MEMORY-STRUCTURE M3 row 1 (the walk's bimodal peak).

Nine's walk peak above settled reads either 20 to 50 MB or 250 to 350 MB.
Footprint categories at the high-mode peak split the excess in two:
WebKit Malloc (JS objects) and "WebAssembly Memory", which on macOS is
JSC's Gigacage, where typed-array and AudioBuffer backing stores live.
The Gigacage grew 133 to 183 MB in 60 s, and the ledger's `audio-buffer`
grew 47 MB in high-mode runs and 5 MB in low-mode ones, so those
buffers were garbage waiting for a GC.

The source is the streamed music and ambient bed (`AacSource`, the
native AAC path). Each half-second window of each stereo stream made
three fresh PCM copies: a 1024-frame plane per decoded packet in
`AacPull`, the window's planes returned by `read`, and the window's
AudioBuffer. That is about 1.2 MB/s per stream, or 140 MB per minute
with two streams, and the page is muted on the meter. V8's sampling heap
profiler never saw it, because ArrayBuffer backing stores are off-heap,
so STR18's [S] owners list left it out.

Now:

- `AacPull` keeps consumed packet planes on a spare list of up to
  eight and reuses them. `read` returns views of one scratch plane per
  channel. Both callers copy into their window's AudioBuffer before the
  next read.
- `AacSource` hands an ended window's AudioBuffer to the next window of
  the same length. Its source has stopped, and `buffer` was set to
  null. At most four spares wait; the oldest goes first, so a seam
  window's odd length cannot block the list.

The resident set is unchanged (the same peak windows), and steady
playback allocates no PCM. On the first locked pairs, high-mode runs
read +102 and +144 MB against base's +283 MB.
`aac-pull-reuse.test.ts` reads 40 windows through two scratch
planes and at most ten packet planes per channel.
