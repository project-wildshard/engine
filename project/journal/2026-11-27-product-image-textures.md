# Product textures read images (SF7i)

Nine Dragon's local cook entered on both tiers but its client plan never
installed: "declared plan refused: Missing KTX 2.0 identifier". Since SF7a
the sign atlases and glyph field are PNGs (J525: a shardfile carries
images), and `loadFolder` in `worldSceneTextures.ts` parsed every product
file as KTX2.

A product file now goes to the KTX2 reader only when it starts with the
KTX2 identifier; anything else decodes with `createImageBitmap` (no
premultiply, no colour conversion), rows as stored and flipY false, so
the first row lands where the KTX2's did. The KTX2 reader (and its need
for the world renderer) is made only for a KTX2 product. Nine's colour
atlas row now says `colour: srgb`, which its KTX2 header carried before.

Reversible default (J505): the client reads the image; the cook encoding
product files to KTX2 can come later without changing this path.
