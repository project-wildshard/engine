# Driftwood from the road: keep its near view to the wall

> Written by: Claude (lane opus-dwfarview)

Jake, 10:02 Cancún on preview, iPhone, from the road south of Driftwood: "the placeholder for Driftwood, whatever this is,
it looks completely broken." Reproduced on preview: walking into Driftwood's wall turns the cell live (`shows: playing`)
while its runtime is not yet drawn (`inside: null`, region root hidden). The near plan excluded the live cell, so its
owning near view (the baked `near.glb`) was dropped at once; the cell fell back to its far proxy, masked region by region
by its L1 / L0 ring tiles, and Driftwood's ring tiles carry its props but not its ground (that lives in the runtime's
island meshes). The hut, lookout and rope bridges drew floating over holes, with the far proxy's coarse ground behind.

`NearPlaceholders.update` now keeps an owning near view that is already drawn for the live cell until its root hides
(the runtime covers the cell), and an owning view never takes the rings' mask, so the arrival ring cannot cut holes in
it. It never starts a near view for the entered cell.
