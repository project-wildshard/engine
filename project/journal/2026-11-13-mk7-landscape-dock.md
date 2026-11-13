# Landscape keyboard dock, measured (opus-mk7)

> Written by: Claude (opus-mk7), 2026-11-13

MOBILE-KEYBOARD MK7 (meta, J297). The question: in landscape the keyboard band is short; do the game strip (80 px floor) and
the chat input stay usable, or should landscape go input-only?

Measured in the iOS 26 Simulator (iPhone 17 Pro, Mobile Safari, rotated with a GraphicsServices orientation event, keyboard
raised by focusing the chat input through the Web Inspector), on a harness with the real `viewport.ts`, `chatLines.ts`,
`base.css` and `touch.css`. The landscape page is 750×292 under Safari's toolbar and tab bar. With the keyboard up
`innerHeight` drops to 36 and `visualViewport` is 16 tall at `offsetTop` 256. The open chat reserves 14 (half the band plus
its gap); the game keeps its 80 px floor. On screen: the input with its text over a strip of world, then the accessory bar
and the keyboard. No chat line fits, and no layout could add one: Safari leaves about 35 pt of page.

No layout change. Phones are portrait-only in the game (RotateGate, E38; MK5 saw the gate close the chat and the keyboard on
rotation), so this page is reachable only in the harness. With only 16 px of band, an input-only dock is what the current
code already shows. `keyboard-fit.test.ts` "MK7" pins the measured numbers (marks 256/272, game 80, back to 292 on close).
Shot: `~/.cache/wildshard/plan-artifacts/mobile-keyboard/mk7/mk7-landscape-keyboard.png`.
