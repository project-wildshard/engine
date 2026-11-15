# CI21 return-projection fixture

The ReturnProjectionV2 test now reads an engine-owned ABI2 guest emitted once by
the SDK, so it no longer reaches into the SDK compiler or source tree at test
time. The fixture manifest preserves the source for an intentional re-emit.

The same bank now holds the legacy guests used by call-results, lane-results and
virgin-memory tests; each was formerly compiled from the SDK during setup.

It also carries the two-stream group-RNG projection guest, retaining the exact
declared IO layout in its manifest rather than compiling SDK source in engine.

The group-members guest completes the same move for ordered native member
effects, including its fixed 1408-byte ABI2 layout.

The six engine-owned guests landed as CI21-H3's public fixture source. Its
separate integration receipt records the J237 batch clocks after this source
is available on engine main.
