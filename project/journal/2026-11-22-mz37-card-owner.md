# 2026-11-22 MZ37: the completion card opens under its owner

- MOSSGATE-ZONE MZ37 (meta): on the Mossgate grid page the card poll passed at the report (`offered` true) and no
  `.ws-complete` ever mounted. `ShardComplete.open` took `uiScope('complete')`, whose parent is the ambient owner; a
  system callback can leave that on a disposed scope (the talk box just closed), so the card scope was born disposed:
  `mountUi` skipped, the layer pushed inactive, `isOpen` false, no error. Re-entering as a done player opened it at once
  (install time has a live owner), which is why it looked like a gate problem.
- `ShardComplete` now takes an owner; `installCompletion` passes the stay scope. `complete-card-owner.test.ts` shows both
  the miss (no owner, disposed ambient) and the fix.
