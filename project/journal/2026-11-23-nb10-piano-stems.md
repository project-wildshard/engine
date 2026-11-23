# NB10: the piano stems follow the pin (opus-compat-w9)

- Three engine main reds (Driftwood r5 4a72bba51, Pine r6 57a386863, Driftwood r8 9166106aa) came from engine's
  piano music.json naming recordings by bytes that a re-pin re-encoded. pin-shard.ts now reads the new product's
  cook.json mounts from its tarball (a small ustar reader, Node built-ins only) and renames each piano file with the
  same stem (island-calm, pine-tension) everywhere the manifest names it; shard-pin.yml commits music.json with the
  pin. Proof: a stale Driftwood manifest is restored from the pinned r9 tarball (test/pin-shard.test.ts).
