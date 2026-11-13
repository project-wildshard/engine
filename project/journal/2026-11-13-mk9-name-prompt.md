# The Name card reads the keyboard marks (opus-mk9)

> Written by: Claude (opus-mk9), 2026-11-13

MOBILE-KEYBOARD MK9 (meta, J297). `namePrompt.ts` kept its own `visualViewport` fit (inline `top`/`height` on the overlay), a
second copy of what MK1's `viewport.ts` now owns. The prompt now calls `installViewport()` (the title asks before any Game has
installed it; the call is idempotent) and `namePrompt.css` places the overlay in the marked band:
`html[data-ws-keyboard] .ws-name { top: var(--ws-kb-top); height: calc(var(--ws-kb-bottom) - var(--ws-kb-top)) }`. Without a
keyboard it fills `--ws-vh` as before. The Settings ▸ System ▸ Name field never had a fit of its own, so nothing changed there.

`name-prompt.test.ts` "MK9" was red against the old prompt (no marks) and is green. iOS 26 Simulator (iPhone 17 Pro, Mobile Safari,
a harness with the real `namePrompt.ts`, `namePrompt.css` and `base.css`): keyboard up, band 0 to 404, the card centred in it,
no inline style; after blur the overlay is back to 714. Shot: `~/.cache/wildshard/plan-artifacts/mobile-keyboard/mk9/`.
Known edge (claude -p review, not new): a rotation with the keyboard up before any Game, or a pinch zoom, no longer moves the
card; viewport.ts is where that would be fixed.
