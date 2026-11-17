# Proofs fail on the error card (ZONE-ENTRY ZE23, opus-netlag)

Nalati's "Something broke" card showed in agent proof runs on staging v0.1.33 and v0.1.34 while `zone-gate-proof`,
`zone-pair-proof` and `journey-proof` passed. Two holes: a frame-loop system's throw never reaches Playwright's `pageerror`
(Game.ts catches it, logs `[faults] system "<label>" threw:` and opens the card or the chip), and the journey and
staging-smoke screen samplers looked for `.ws-err`, a class nothing in the game has (the card is `#wserr`).

`scripts/proof-faults.mjs` is the shared check: `watchFaults(page, errors, who)` before the first goto, `settle()` before
the verdict. An init script logs each `#wserr` / `#wserr-chip` as it mounts, so a chip that fades by itself, or a card on a
document a zone entry navigated away from, still fails the run. Proved on preview: Driftwood with a `Game.onUpdate` throw
injected fails it (the chip as a player, the card with Developer on); the same boot before the injection is clean.
