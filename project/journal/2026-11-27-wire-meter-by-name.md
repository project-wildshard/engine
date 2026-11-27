# The wire meter enters a zone by its name (QA 11-26 row 30)

Lane opus-public. SF13's wire meter sweep over every zone measured only
Driftwood: the meter tapped the deck's card through its dots, and the
deck shows no selected card past the first, so every later zone timed out
and the open plots and the newer zones had no card at all. The meter's
default flow is now `zone`: it enters `--shard` by its name through
`zone-entry.mjs`, as the zone-cook and ship proofs do, so a sweep reaches
every zone the page holds. `--flow select` and `--flow grid` stay, and
`shard-size-watch.mjs` meters shards by name too. The baseline's numbers
came from the deck flow; a remeasure by name skips the deck's card art in
the title stage.

Guard: `test/shard-wire-meter-zones.proof.mjs`, run through
`browser-lane.sh` against a built checkout, sweeps Driftwood (the deck's
first card) and Pine Hollow and fails unless both enter and read their
own zone files.
