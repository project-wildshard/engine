# Load splat materials and neighbour discovery on demand

Cooked phone splat layers added 1,400 raw session bytes in 627dcac4.
Its layer reader and timing fix, 610e482c, passes the three affected
test files and leaves 83 raw bytes below the session cap on the mini.
It follows a hosted boundaries reading 2,236 bytes over that cap,
after 506fcd8f added the neighbour's phone-layer discovery read.

Load the cooked reader and the splat array compiler together only for
splat ground. Complete cooked file reads before owning a KTX2 decoder.
Ordinary textures still start decoding on the caller's stack.
Load the discovery parser only when phone prefetch has a discovery
document. The phone still uses the cooked layer and skips its blob.

All 139 focused tests pass. The Template production build is 4,396,488
raw bytes and 1,358,724 gzip, with 3,512 and 2,776 bytes of headroom
under the existing caps.

The later shard-format 0.41.1 pin adds a separate bundle overage.
This split compiles and passes the same 139 tests with that pin.
