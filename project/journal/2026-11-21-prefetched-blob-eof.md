# Read the end of a prefetched Blob on Chromium

The combined nightly and local Metal reproduced Nalati Explorer's cold
boot stall. Local instrumentation saw all 75 speculative fetches and
their Blob reads settle. Four of the audio consumers got their full
bodies, then their final BYOB read never returned end-of-stream.
The proposed early queue start did not change that and was dropped.

Read the already-buffered prefetch responses through their default
reader. Native stream bodies keep the pooled BYOB path. The regression
test proves the prefetched bytes are borrowed once, retain their length,
and reach EOF without attempting a BYOB read.
