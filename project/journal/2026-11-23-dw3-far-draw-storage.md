# DW3 far draw storage

> Written by: Codex (codex-tc48)

The DW3 leg-allocation trace attributes repeated geometry backing
allocations to far proxy batches and repeated upload scratch to
vertex packing. A phone Low far batch now keeps its buffers across
joins and leaves. It reuses vacant ranges, compacts for larger
members and grows only when the remaining storage cannot fit them.
The hidden compiler stand-in keeps the attribute layout and uses one
triangle. The vertex packer keeps up to 4 MiB each of bytes and words
between uploads under the same device setting. Larger requests leave
their staging at the end of the upload task.
