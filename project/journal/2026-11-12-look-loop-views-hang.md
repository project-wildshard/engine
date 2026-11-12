# Look loop: views.mjs hung on desktop FP cameras

> Written by: Claude (opus-viewsfix), 2026-11-12 ~00:10 Cancún

- LF1-0 and LF1-3 set `fp.tier: desktop` and a 1400x933 FP viewport to
  match desktop 3:2 targets. `views.mjs` still opened the FP context as
  an iPhone (UA, isMobile, touch), so RotateGate's
  `(orientation: landscape) and (pointer: coarse)` query matched, the
  rotate page covered the game and `frameGate()` stayed false: the
  ready wait timed out at 150 / 300 s. Reproduced on a Mossgate build:
  `hud.entered` true at 2 s, frame gate false for 40 s, "PORTRAIT ONLY"
  on screen. Not the Name prompt (a skipintro standalone page has none).
- Fix: `contextOptions()` in `cameras.mjs` makes only `fp.tier: phone` a
  touch iPhone; `parseCameraFile` refuses a landscape phone viewport.
  `views.mjs` seeds `NAME_ASKED` for builds with a world and names what
  holds the gate on a timeout. Proof: 9 of 9 frames of t1-08, three
  runs, each context ready in 2 to 3 s.
