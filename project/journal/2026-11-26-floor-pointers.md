# A floor moves only past every pointer (opus-floor143, meta QA 11-25 row 143)

- FP24 raised shard-format's floor to 0.1.0.1 while production's open-plot-desert-ruin and open-plot-thin-ice pointers
  still named their r1 originals, whose shard.json says 0.1. Nothing looked until v0.1.96's server release played
  production and refused 25/27; opus-rel86 flipped both pointers by hand.
- A floor reaches engine as a shard-format pin move, and the pre-push already reads the API on a pin move (CP3). It now
  also reads every production, staging and preview pointer from /api/catalogue and the format each original declares in
  its own bytes (never the ledger key: CP16's stored-floor tool moved r1's key to 0.1.0.1 and left the bytes at 0.1), and
  refuses the pin move with the list. Escape hatch ALLOW_FLOOR_POINTERS=1; an unreadable API warns and passes, as CP3 does.
- Each original's format is cached by hash in ~/.cache/wildshard/raw-formats.json: the first read took 28 s for 35
  originals (81 pointers), later pin moves read only new ones. `node src/scripts/format-floor-pointers.mjs` prints the
  same check against the installed floor for a release lane.
- The storage leg of the download goes unmarked: only the API request carries the agent marker.
