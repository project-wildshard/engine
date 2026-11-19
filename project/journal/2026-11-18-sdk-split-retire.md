# SDK split retires the engine's author copies

SP13 moved the four remaining heavy producers onto the split SDK. Format now
supplies the RNG, terrain and interaction laws directly to engine callers.
The renderer keeps its terrain slicing and voxel shading for live geometry.
The SDK owns the geometry bank, voxel bake bank, synchronous terrain bake and
placeholder producer. OF5b2b owns the legacy creature registry and fallback.

The focused tests exercised the retained RNG stream, forest, collider,
terrain, riding, and declaration contracts. Historical author parity uses
the older published engine as its oracle.
