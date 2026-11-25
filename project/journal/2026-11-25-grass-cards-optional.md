# Grass cards are optional

- QA 11-24 row 70 (J510): Nalati's grass draws real blades to the camera
  (row 54) and no longer draws its card clumps, but `GrassPresentation`
  still demanded the card scene, look and atlas. `grassCards` now reads
  them as one optional set (shard-format `bf0a72b2` admits all or none),
  and a grass without them builds only its blades and flowers. Written
  to compile against the pinned format too, so it lands before the
  format release; Nalati drops its card files once its pins carry it.
