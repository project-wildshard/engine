# Admit native compressed road maps as one shared pair

> Written by: Codex

PZ24d2 loads the baked surfaces only on phones whose capability probe
sampled native sRGB ASTC 6x6 correctly at every mip. The general engine
query stays in core/ktx2. The GPU allocation is 941,280 bytes, reserved
with its temporary mip storage before any read. Both maps are checked,
uploaded and published atomically; one parent count owns them across
both halves. Failed reads, invalid formats and unsupported devices use
the unchanged procedural path. Cancellation disposes late results.

The composer format and its negative-alpha marker remain untouched.
Asset and runtime tests cover the real mip chains, source hashes,
partial failure, scope retirement and last-borrower disposal. The local
memory proof and final golden verdict remain PZ24d3.

The first live candidate measured 42.4 MiB instead of the target: the
compressed junction was cached as road.junction, while the builder
uses road.junctions. The missing-slot assertion failed red first; the
correct slot now passes. Re-run memory and final goldens on the fix.
