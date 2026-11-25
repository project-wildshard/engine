# A runtime page draws its product's level look

QA 11-25 row 52, opus-fr13. Nalati built on SDK 0.4.34 never entered: the preparation client stopped at level.world with
"Sky: the HDRI rig needs level.sky.hdri".

- Which side was wrong: the engine. FORMAT-PRUNE FP47b moved the level look (sky, atmosphere, grade, horizon) out of
  the discovery document into the product's `look/look` (`look.level`), and sharddev 42a563ad (SDK 0.4.32 on) stopped
  copying it into discovery on the word that the engine reads `look.level` first everywhere. The declared page and the
  grid paths did; a runtime page (a discovery naming its client-plan entry, Nalati's kind: `installManifestShardfile` in
  `clientSource.ts`) took its start from its product (FP54) but its level look from discovery alone, so it got
  `PLAIN_LEVEL_LOOK`'s sky, which names no HDRI, and Nalati's look has no backdrop to stand in for one.
- The fix: `nativePageLevel` (`declaredLook.ts`) gives a runtime page its product's `look.level` over its discovery's, as
  `declaredLevel` does for a declared page. A product with no level look keeps its discovery's.
- The guard: `test/native-page-level.test.ts` rebuilds every live pin's level look as the newest SDK writes it (no look
  in discovery, the open plots' and Mirror Salt's lifted into `look.level`) and requires the page to draw the sky,
  atmosphere, grade and horizon its pin draws today, HDRI included.
