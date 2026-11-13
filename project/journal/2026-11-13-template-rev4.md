# Template rev 4: Mossgate's pond beach (opus-templates)

- Jake, 2026-11-13 ~18:45 Cancún: "we should deploy the latest version
  of template1 & tempalte2 right". Engine pins `template` revision 4
  (`88464126…`, 9,369,088 bytes, v0.2.11, sharddev `51dcf6d`). New since
  rev 3 (`6d6cf02`): the pond bowl shelves to a beach (`01b2290`) and
  the hero recaptured after it (`47c6f58`). The Mossgate LUT has been in
  the shard file since rev 2; nothing about it changed.
- Built `--folder-only`, prepared with no `--base` (engine's v0.1.18
  preparation client: 35 programs, fence 180), built and uploaded with
  `--channel staging`, so preview and staging moved and production waits
  for this pin's release.
- Brasscap (`blender-template`) stays on rev 3: shard-format has no
  Brasscap source change after `285a9a2`.
- The pond moved the level, so Ring 1's template chain is re-recorded
  (`fb8923d0…`, Darwin and Linux the same chain, as every row) and the
  released v0.1.1 Template save is refused by rev 4, as it was by rev 3.
- Proof on a worktree of `d19ed2a2`: `ring1.sh cook-step` (re-recorded)
  and `build-boot` green (standalone gameplay PASS, 0 faults); the 18 pin,
  save, grid and catalogue test files pass (218 tests).
