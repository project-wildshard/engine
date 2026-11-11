# MOBILE-GRAPHICS MG8-MG9: Low / High you can see, and a smaller toggle

Jake, 2026-11-10 ~21:45 Cancún (meta QA 48): "it's really hard to kind of
see the change in the graphics quality… come up with some options and
variants… if the high-low model could be made smaller… 33% transparency
always, but when you press the buttons it goes to 90% and then it fades
back over 10 seconds to 33%." Prototype on `plan/gfx-toggle`; nothing
lands until he picks from the board.

- `core/graphicsQuality.ts`: seven presets of what Low and High pull
  (pixels, sun shadows, MSAA, bloom + god rays, the level's FXAA), picked
  in Debug > Look > Graphics levels, applied live by `Game.applyQuality`.
  No pick = MG2 exactly. No URL switch: the lint is right that Jake plays
  the home-screen app and has no address bar, so the brief's
  `?gfxQuality=` became two Debug rows.
- Shadows off clears each cascade with a pass that draws nothing (camera
  layers 0) and then skips the shadow pass. Surprise: a clear made at
  buildComposer did not hold, because the loading card's parted shadow
  draws refill the maps outside the wrapper; it clears again on every
  apply and at control-ready.
- On the M5 Max the GPU is not fill-bound at 402x874: Low 1x and High 2x
  cost the same there (~0.7 ms). Shadows are the lever that shows on
  Driftwood (posts, palms on the rocks) and the one that cuts draws
  (112 -> 67).
- `game/firstPlay.ts` `showToggle`: three smaller toggles, picked in
  Debug > Look > Graphics toggle and shown on every entry while picked.
  A is Jake's spec (rest 33%, a tap jumps to 90%, 10 s linear fade, all
  three constants exported); B a one-row pill whose line drops under it
  for 4 s; C a 48 px LO / HI badge under the minimap that flips on a tap.
  A Debug pick swaps the variant live without marking the device.
- `scripts/gfx-toggle/compare.mjs`: Low against High per preset on two
  Driftwood views (shots, 3x crops, GPU ms from timer queries over 24
  stepped frames), and `--toggles` for each toggle's rest and tap frames.
- Test timings for the two new test files recorded (push-test-timings).
- Codex's read-only review, folded in: "Shipped" now puts every lever back
  (it used to leave shadows off, MSAA or glow until a reload); the no-
  shadows clear tracks the maps it cleared, not the calls (a parked draw's
  stand-in map no longer marks the real ones clear); any preset picked at
  level build keeps bloom and rays in the chain (a preset picked later
  glows from the next entry). Still open: MSAA with WorldRenderPass's mid-
  frame depth blit where the browser lacks multisampled render-to-texture
  (iOS Safari): presets 3 and 5 only, neither recommended.
- Jake, ~22:45-22:50 Cancún, after the first board: no High above
  yesterday's cost; every knob a toggle in the Graphics settings. The
  seven presets are gone. Now: Screen 3x/2x/1x and Render scale 100%/75%
  (drawing ratio = min(dpr, screen) x scale), Shadows, Bloom, Sun rays and
  Edge smoothing (off / FXAA / MSAA), all live, in one block
  (`ui/graphicsBlock.ts`) with a frame readout. Low and High are starting
  points: High = every control as shipped; Low = 1x and no sun shadows.
  Bloom, rays and FXAA rebuild the colour chain live when what it holds
  changes (at opacity 0 an effect still costs its composite).
- Rebased onto `plan/settings-redesign` (Jake picked layout A, J245): the
  controls are a block in A's Graphics tab (`gfxControls`); the tab's
  Render scale and AA rows hide on a phone, and a Screen / Render scale /
  Edges pick clears QA 25's Developer pixel pick and the boot-time
  render-scale / AA prefs, so one set of pixel controls is left.
- Jake ~23:05: Low · High · Custom. Low and High set every control;
  Custom is a disabled indicator, lit when the values match neither;
  the label is read off the values, never saved. The in-world toggle A
  follows it (on Custom neither button is lit; Low or High applies).
- Jake ~23:15: the phone's render cap is 60 only on exactly Low with Low
  Power off, else 30 (G896's 30 stays for High, Custom, Low Power).
  `tier.ts frameCapFps` asks the game's cached cap; the sim's 60 Hz
  fixed step and every server tick are untouched.
- Jake approved A (~23:20): it is now the only in-world toggle, and it
  replaces MG5's first-play card. B, C, the Debug row and MG5's card are
  gone; Settings > Graphics > In-world toggle shows A on every entry.
- Test timings for graphics-presets.test.ts recorded.
- Jake ~23:45: one "Pixel density" control, 1x / 1.25x / 1.5x / 2x, no
  3x, no Native, no Auto anywhere, anti-aliasing On / Off (MSAA gone).
  Screen and Render scale merged into it; on a phone it is the only
  pixel control: the boot-time render scale and AA rows hide, Quality
  shows Phone / Desktop with no Auto, and QA 25's title card is removed
  (its devPixels pick stays a Developer override off the phone path, for
  tests). The title's Settings mounts the same block on a phone.
- The QA 25 title pixel card's file is deleted in its own commit.
- The readout says the cap in force now and the last play's numbers (a menu over the world holds its frames, so they are not live there).
- Rebased onto settings layout A as built (`7d5d17f6`, J245) as one
  squashed change. The controls now go through its Graphics registry
  (`registerGraphicsSettings` in `ui/graphicsBlock.ts`, called per level
  from `play.ts`): `mode` becomes Low · High · Custom, `tier` drops Auto,
  and on a phone `scale` and `aa` hide behind Pixel density and
  Anti-aliasing (a desktop keeps them). Rows: main (presets, density,
  readout), effects (shadows, bloom, rays, AA), setup (In-world toggle).
- The QA 25 title card's file is deleted in its own commit (the source stamp reads HEAD's tree, so a delete can't ride with code).
