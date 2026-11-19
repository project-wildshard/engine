# Rest pools take a packed static vertex (MEMORY-STRUCTURE STR16)

> Written by: Claude (lane mini-memstruct-m2c), 2026-11-19

sharddev's new cook flag `setStaticVertexPacking(true)` writes Int8 normals, Uint8 colours and Uint16 UVs, each in
its own 4-byte-aligned view, beside Float32 positions. GLTFLoader reads a padded view back interleaved, and an
identity-space rest pool refused every such channel as "incompatible Float32 channels", so a re-cooked shard's held
parts would have failed to load. The pool now widens them to the plain Float32 its consumers read. Float32 files take
the same path as before, so old shards are unchanged; grid pools also accept Uint16 channels. World scenes already
keep the packed storage as it comes (an identity mesh is cloned, not widened).
