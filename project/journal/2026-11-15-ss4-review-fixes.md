# SHARD-SOURCE stage 4: the review's open findings (opus-ss4d)

- Sway moved a vertex along `transpose(mat3(model)) * wind`; that is the
  inverse only for a pure rotation, so a frond scaled 3x swayed 9x its
  declared metres. Now `inverse(mat3(model))`; a CPU check in
  `scene-surface.test.ts` shows 1 m against 9 m.
- AP8's merged props keep their own mesh on SHADOW_LAYER, which the World
  Explorer's tap raycaster skipped. `mergeView` marks the member
  (`MERGED_VIEW`); `pick.ts` tests SHADOW_LAYER for its one call and keeps
  only drawn surfaces, so a cabin's depth proxy still is not picked.
- Engine tests start red for everyone since 2026-11-14 13:00 Cancún: the
  CI21 batch deadline (`test/lift-pending-policy.json`, J237) passed with
  codex-mock's batches pending. Local runs here pin the clock with
  `WS_CI_EXCLUSION_AT`; a push waits on that owner.
