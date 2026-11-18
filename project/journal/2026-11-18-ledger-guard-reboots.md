# The ledger guard boots a zone again when its boot never loads

An hour after the confirm-once change (see
2026-11-18-ledger-guard-confirms.md), main run 44300884519 on b6baf0ee
reddened memory-ledger-guard in a different way. Driftwood's only boot
stopped at "props" with the game's own "no progress for 61 s" modal, so
`measure.mjs` exited 1 and `ci.mjs` threw before any zone was compared.
The run before it read Driftwood at control (195 MB), so this is one
bad hosted boot, not a zone that cannot load.

Hosted SwiftShader blocks the page's main thread for long stretches.
The stuck-step watchdog already counts at most 2 s per gap, so this
boot really did sit about a minute without the card moving. It is
still a single sample, the same class as the readings that flapped.

`confirmZone` in `ratchet.mjs` now owns the comparison guard's reading
of one zone. A boot that is over the line is booted again, as before,
and so is a boot that never reaches control. That zone then fails only
if the second boot fails too, and the failed first boot is left out of
the comparison. Record mode, and a zone with no baseline, keep the
first failure. A shard that really stops loading fails both boots.
