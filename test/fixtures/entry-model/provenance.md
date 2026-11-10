# Compressed item model fixture

Produced with frozen installed sharddev v0.1.0, format v0.4.2 and
Three v0.186.0 in the private SDK arm proof checkout. The exact source
is the inherited SDK entry-model-admission case: BoxGeometry with
width/height/depth 1/2/3 and three segments on each axis, a default
MeshStandardMaterial, then staticGlb with compactIndex true and
compressGlb. The result is 3124 bytes, SHA-256
40314bf53c6a13bf412baefc996d00e8e69fd26bae4c6f2092f82d26d75d17b0.

The consumer verifies actual meshopt buffer views and compares every
position, normal, UV and index to the independently constructed Box.
This is decoder input, not a new shipping model or a pixel golden.
