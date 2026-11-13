# One texture form per device and tier (opus-of17, OFFLINE OF17)

> Written by: Claude (opus-of17), 2026-11-13

Nine Dragon's grid page read its KTX2 stand-ins (`scroll.phone-<h>.ktx2`); its one-shard page's own rule (the phone tier's
`textures: 'img'`; the grid's over-cap estimate counts residents, the one-shard page's doesn't) asked for
`scroll.phone.webp?v=`, which no visit had cached, so `readContent` parked LOAD on RETRY at 15/31 for good offline.

- `gpuFiles.ts`: a build that reads a KTX2 stand-in under Auto notes the shard (`ktx2set:<slug>.<tier>.read`, beside the set
  markers; Clear downloads drops both). A later page whose rule says images reads KTX2 instead ("this device read <slug> as
  KTX2 (OF17)"). Only towards KTX2: it is never the bigger form, so a grid page's memory rule is never undone.
- `core/ktx2.ts` `heldForm` / `readHeldForm`: when a form fails to read and Cache Storage holds the other one, read the held
  one. `readContent` takes an `instead` hook, asked before it waits on RETRY. Used by `loadTexture`, the held viewmodel maps,
  baked textures, terrain arrays and the GLTF stand-in hook. A harness pin keeps its one form.
- offline-proof rule 9 (`texture-form-not-warm`): an offline run never reads an image whose KTX2 stand-in the warm visit read.
- Proof (headless, a build of main plus this change only; the working tree's title closure was over budget from other lanes'
  uncommitted edits): preview deck offline reaches play with no rule-9 read; staging-like offline still stalls at START on OF5's
  route set (`-client-` manifest not held), before any texture. A one-shard page offline with the note and only images
  cached reads KTX2 (OF17), every stand-in fails, the held images load, play in 11 s.
