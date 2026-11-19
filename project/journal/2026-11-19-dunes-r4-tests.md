# Dunes rev 4 tests: main red fixed forward (J249)

- Dunes rev 4 (463218ac7) ships its homes as declared spawns, so six engine tests built on rev 3's keeper homes went red.
  Their fixtures now keep r4's shipped brains, strikes and looks; the keeper-parity, home-refusal and census-homes
  checks move to the declared bodies (the keeper stands no home to compare against).
- Real gap found: a declared spawn's respawn ran at plain dt in a room, losing J109 (faster with players near) that the
  keeper's homes had. `dataRespawn` now runs each clock at `roomRefillRate`; one player's clock is unchanged.
- The v0.1.1 Dunes save is now refused whole on r4 (its level lists the declared spawns), proven on the native resident.
