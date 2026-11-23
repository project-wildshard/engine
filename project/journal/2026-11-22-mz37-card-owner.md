# 2026-11-22 MZ37: the completion card opens under its owner

- MOSSGATE-ZONE MZ37 (meta): on the Mossgate grid page the card poll passed at the report (`offered` true) and no
  `.ws-complete` ever mounted. `ShardComplete.open` took `uiScope('complete')`, whose parent is the ambient owner; a
  system callback can leave that on a disposed scope (the talk box just closed), so the card scope was born disposed:
  `mountUi` skipped, the layer pushed inactive, `isOpen` false, no error. Re-entering as a done player opened it at once
  (install time has a live owner), which is why it looked like a gate problem.
- `ShardComplete` now takes an owner; `installCompletion` passes the stay scope. `complete-card-owner.test.ts` shows both
  the miss (no owner, disposed ambient) and the fix.
- Second half: with the owner fixed the card opened, and a second later its modal `back` ran: the report talk box was
  still up when the done flag landed, so the card opened over it and the Escape that closes the talk closed the card.
  The poll now also waits while any UI layer blocks (`app.ui.blocking`); `data-cell-completion.test.ts` covers it.
