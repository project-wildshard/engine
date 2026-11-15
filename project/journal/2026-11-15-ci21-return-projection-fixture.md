# CI21 return-projection fixture

The ReturnProjectionV2 test now reads an engine-owned ABI2 guest emitted once by
the SDK, so it no longer reaches into the SDK compiler or source tree at test
time. The fixture manifest preserves the source for an intentional re-emit.
