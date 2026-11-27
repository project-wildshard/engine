# SF6: a specimen atlas from an image

> Written by: Claude (opus-cookktx2), 2026-11-26

Nalati's re-pack carries its painted models' atlases as PNGs (J525).
Specimen preparation now reads the cook's KTX2 of such an atlas by the
image's hash, as clientMaterials does for image blobs, and decodes the
image when the table has no row. KTX2 atlases read as before.
