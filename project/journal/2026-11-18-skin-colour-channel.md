# A colourless skin gets a white colour channel (ONE-FORMAT OF27b5)

The OF27b4 parity board drew Nalati's wolf black on the skin path. Its painterly material reads vertex colours (the
family default) and the wolf GLB has no COLOR_0. The painterly family adds a white channel in `onBeforeRender`, but by
then three has bound the mesh's buffers without it, and the cached binding never picks it up. `loadClientSkin` now
adds the white channel at load, before any draw (`colourForVertexMaterial`, `skin-colour.test.ts`).
