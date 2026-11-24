# The phone's frame cap ignores the Low Power guess

> Written by: Claude (lane opus-perf), 2026-11-24

Meta QA-FEEDBACK-2026-11-24 row 31, Jake: *"Driftwood FPS is still dogshit"*.

QA 11-23-b row 8 stopped the title's Low Power guess from holding a phone on Low, but the frame cap still read the guess:
`frameCapFor(presetLabel(), lowPowerOn())`. A busy title or a flagship that read "likely" kept exactly-Low at 30 fps for
the whole tab, because the reading only clears when the page comes back into view. The cap now reads `lowPowerHolds()`
(off), through `phoneFrameCap()`. A phone truly in Low Power Mode loses nothing: Safari hands it 30 Hz animation frames,
so a 60 cap draws 30 there anyway. High stays at 30 (J246, J283).
