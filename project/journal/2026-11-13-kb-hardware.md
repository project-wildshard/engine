# A hardware keyboard is not a keyboard open (opus-mk8)

> Written by: Claude (opus-mk8), 2026-11-13

MOBILE-KEYBOARD MK8: a phone with a Bluetooth keyboard focuses the chat field and Enter sends, but iOS shows no on-screen
keyboard, so `visualViewport` keeps the whole page (a 0 px inset). `keyboard-fit.test.ts` now drives that: field in focus, Enter,
blur, all at full height. It passed on today's main before any change: MK1's 120 px floor in `keyboardFit` already keeps
`data-ws-keyboard`, `--ws-kb-top`/`--ws-kb-bottom` off and the game un-resized. The row closes as a guard test, no code change.
