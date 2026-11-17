# The far herd draws are declared on the model contract (main red, buddy-engine)

- Main went red on run 44185630654 (3863b0db..b1d85fc6, tests (4)):
  `model-contract-paths` "holds on the real engine tree". ONE-FORMAT
  CC54 (`bakedHerd.ts`) and CC55 (`herdSprites.ts`) each make one
  `new THREE.InstancedMesh` in shared code, which has been a DONE area
  since M6.
- The contract has two ways in. `defineModel` / `place` draws placed
  copies that stand still (its `instanced` draw). A herd's copies move
  every frame under a baked-skin or card shader, so they are not placed
  copies. `PosedInstances` (the posed-crowd owner) has one material and
  no groups, no shadow caster and no tint, and packs a pose rather than
  the rig's own matrix. Moving onto it would rewrite CC54's draw while
  main is red.
- So both files are declared world, as the shared creature and
  population draws already are (`posedInstances`, `crowdDraw`,
  `foragerDraw`, `skinPlayback`). Each has its reason and a ceiling of
  one InstancedMesh, and the test's one-draw table now fails a second
  draw in either file.
- The `reading 'bones'` line in the same log is
  `sentry-automated-faults`' own planted fault (its test passes), not
  the herd.
