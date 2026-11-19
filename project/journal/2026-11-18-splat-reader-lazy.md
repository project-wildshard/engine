# The splat phone layer reader loads only where it is used (fix forward, main ci 44426038579)

- 627dcac4c put the cooked splat layer reader (`readSplatLayer`, `cookedSplatBytes`) in `clientMaterials.ts`, which
  every device boots: the session bundle read 4,400,208 B raw against its 4,400,000 B cap. The reader now lives in
  `splatLayerRead.ts` and is imported only by a phone drawing a phone set (a local build drops 463 B).
- The same commit awaited that read for every shard before the first transcode, so a scope disposed straight after
  `clientMaterials` began had no pending texture yet (`client-material-loader-lifetime`). A shard with no phone set, or
  a device drawing the desktop set, starts its transcodes on the caller's stack again (DL17).
- `output-descriptor` (OF10a2) and `live-product-preparation` learn the new `splatLayer` argument and global.
