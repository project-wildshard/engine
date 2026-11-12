# Pine Hollow rev 2 pin (opus-slot)

- Today's shard slot (meta J279) uploaded Pine Hollow revision 2
  (`f45e25f2…`, 346,315,776 bytes, version 0.0.1, shard-pine-hollow
  `6f69b83`) to `api.wildshard.io`; the identity migration moved all three
  channels' pointers. `pins.ts refresh` moves Pine's row here so the next
  page release carries it: pages bake engine's pins, not the API's heads.
- Why: revision 1's KTX2 table names 81 files it doesn't carry (the
  desktop NPC GLBs, rigs, birds and phone `astc6` textures such as
  `astc6/tex/rock_ground/nor_gl-78bf8132.ktx2`). That is GAME-89 on
  desktop and Pine's phone-tier 404 on staging (NET-LAG NL1). Revision 2
  names none it lacks.
- The release save now names the new pin and resumes on it. Pine's phone
  download shrank to 37.09 MB, latched with `--ratchet`.
- Held: Template (Mossgate v3, `169ae525`) is uploaded too, but the
  released Template v0.1.1 save refuses it ("Incompatible simulation
  snapshot"), so its pin waits for a lane that re-cuts that save.
  Brasscap (`c74e27f2`) is uploaded; its pin bump is its own lane.
