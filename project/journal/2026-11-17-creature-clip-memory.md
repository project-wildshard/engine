# Account for creature clip buffers

> Written by: Codex
> State: verified locally, 2026-11-17.

The moving engine main now checks ownership of streamed typed arrays.
Creature clip decoding, interpolation and collision frame capture use
the same owned buffer allocator. The sampler validates each view
before allocating its decoded values.

The creature clip, skin and collision controls passed 48 cases
across five files. Engine lint and types passed on the same tree.
