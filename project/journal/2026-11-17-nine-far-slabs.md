# Nine far slab levels (NB23 b)

- mini-nb23b, 00:05 Cancún: Jake picked NB23's (b), far slab decimation. Done in the engine, not the shard's cook: the
  slab format has no near/far switch, but the phone's slab tree already draws per leaf. The tree worker now also clusters
  each chunk's vertices on a 0.3 m and a 0.8 m grid (apart by face direction and colour) and writes each leaf's coarse
  triangles into room reserved after the index before the first upload (a GPU buffer never grows). A leaf at least
  cell / 0.004 away draws its coarse copy. Street-route walk p95 0.96 to 0.90 M; 0.8 M still not met.
- Surprises: a 0.15 m first cell merged the window frames of the towers beside spawn (3.7 k px); clustering without
  colour painted an orange triangle over the gate at 0.005.
