# A zone's baked files, ground and sky under its slug

> Written by: Claude (opus-repacks), 2026-11-26, meta standalone-shardfiles SF4 (client half), for SF6 to SF9.

A re-packed zone carries its own copies under `/assets/<slug>/`, so the engine now reads them there first:

- Baked files (`navmesh.bin`, `terrain.bin`, `sky.json`, `far.*`, `near.*`, `tex/`) at `/assets/<slug>/baked/`, through
  `bakedFile` and `zoneFolderFirst`, else the engine-wide `/assets/baked/<slug>/`.
- The colour grade at `/assets/<slug>/lut.bin`, else `/assets/lut/<slug>.bin`.
- A ground layer named by its folder URL (`groundLayers: ['/assets/<slug>/tex/<set>']`), else the engine-wide
  `/assets/tex/<id>/` (`texBase`), on both the image and the KTX2 path.
- A sky named by its stem URL (`hdri: '/assets/<slug>/hdri/<name>'`), else `/assets/hdri/<name>` (`hdriStem`).

"First" means the page's byte table lists the zone copy; a zone not yet re-packed reads exactly what it read before.
