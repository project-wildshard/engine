# Grass cards are optional

- QA 11-24 row 70 (J510): Nalati's grass draws real blades to the camera
  (row 54) and no longer draws its card clumps, but `GrassPresentation`
  still demanded the card scene, look and atlas. `grassCards` now reads
  them as one optional set (shard-format `bf0a72b2` admits all or none),
  and a grass without them builds only its blades and flowers. Written
  to compile against the pinned format too, so it lands before the
  format release; Nalati drops its card files once its pins carry it.

# Offline first visit says so

- QA 11-24 row 25: offline right after PLAY on a first visit (no service
  worker control), the start's chunks fail and guardBoot's SB53 wait held
  the card at START 84 % with nothing on it. The wait now puts a plain
  line on the card and takes it away when the network is back. Local
  headless proof: line 0.2 s after PLAY; main's build showed none in 45 s.
