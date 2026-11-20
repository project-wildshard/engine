# Native AAC must answer before a flush (K6c)

> Written by: Claude (opus-k6), 2026-11-20

Driftwood (18a9e2c and faa0f55 alike) entered in macOS WebKit on the v0.1.57 preparation client in 5 to 9 s, yet publish's
"Prepare in phone WebKit" on ubuntu-24.04 timed out at 240 s. In Playwright 1.65's noble container the bar stopped at
"Audio · Prepared audio clips 86 / 91" and the boot went fatal after 60 s with no progress. DF9's coarse fans were not
involved.

Linux WebKit's WebCodecs `AudioDecoder` (GStreamer) says it supports `mp4a.40.2` but returns no output before a flush.
`AacPull` (the streamed phone beds, 577cf8cba) keeps at most eight packets in flight, waits for one to come back, and
flushes only at the stream's end. Driftwood's three beds sat at 24 decodes and 0 outputs. macOS WebKit answers by the
eighth packet within a millisecond.

`nativeAacFactory` now feeds a probe decoder the recording's first eight packets, without a flush, once per channel count
per page. A decoder that returns nothing within 3 s is not native here, so the bed takes the existing non-native path. In
the same container, with `AudioDecoder` absent from the page, faa0f55 enters.

Failed first: `src/client/engine/audio/aac-native-probe.test.ts`.
