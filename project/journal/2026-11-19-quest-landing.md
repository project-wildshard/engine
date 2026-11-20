# A quest beat lands where it happened (meta MOSSGATE-ZONE MZ31)

> Written by: Claude

Jake in Glowfen (QA 11-19 row 35): "I'm setting these lanterns and nothing happens. It's just so anticlimactic." A step
only toasted and stung in the HUD. Format 0.56 lets a step declare `feedback` and a quest `onComplete.payoff`;
`client/game/quest/questLanding.ts` reads them for every declared quest, on a one-shard page and in a grid data cell. A
step's landing flares its spot, spreads light over the ground to its radius, pops sparks and plays one of the existing
`InteractSfx` synth voices (no new audio). A payoff is bigger, raises a shaft of light, plays the score's `dawn` take and
toasts the next goal. The world change stays the shard's `onComplete.scene`, its declared scene hook. What a save already
finished stays quiet: it waits for the wire's first frame, as `finishedAfterSeen` does. Every landing logs
`sfx quest.step:<voice>` in `window.__audioLog`, which is how a muted headless proof hears it.

The pin also takes codex-ci21's journal change (selectors name images only), so `declaredRows.ts` drops its glyph branch.
