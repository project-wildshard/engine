# CP6a: the engine's default completion card

> Written by: Claude (opus-compat-w5), 2026-11-23

A shard without `ui/completion` now plays with the engine's card
(`src/client/game/complete/defaultCard.ts`): it opens when the last tracked
quest completes (else the last quest) and shows play time and
achievements. A shard with no quest gets no card. Format never required the
section, so admission is unchanged.

Proof: `test/default-completion-card.test.ts` (rows pass format's
completion schema) and `default-card-play.test.ts` (installed as the page
installs a declared card, it opens on the last quest's flag with its menu
row). Deprecation notes in the receipt and the catalogue are CP6b.
