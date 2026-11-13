# Android Chrome: a black world, and touches that stick (opus-androidblack)

> Written by: Claude (opus-androidblack), 2026-11-13

Jake's friend on Android Chrome (staging v0.1.16, QA-FEEDBACK-2026-11-13 row 6): the game joined and played, the HUD and minimap
drew, the 3D view was the page's own background (#050810, sampled from his shot: the canvas was transparent, not black). Later he
said it rendered, went black after a jump, and then nothing answered his touches. Sentry had only `setPointerCapture`
InvalidStateError (WILDSHARD-GAME-2M, 6 events, device reported as "K" / Android 10: Chrome's reduced user agent hides the model).

- **Touch (safety net, not the cause).** opus-androidemu found the cause: Chrome 145 on Android grants `requestPointerLock` on a
  tap (play.ts `player.lock()`, bootstrap.ts canvas click; that lane gates them on touch); while the lock holds every touch goes to
  the canvas and `setPointerCapture` throws InvalidStateError. `capturePointer` (input/dom.ts) is every client capture now and
  swallows that throw. The throw had skipped the rest of the attack press and raised "A glitch was reported". TouchControls
  also releases a finger whose capture was refused from the window, since its lift can land outside the layer and leave the
  stick, look or attack held. `test/pointer-capture.test.ts` keeps raw `setPointerCapture` out of src/client.
- **Silent black world.** The composer drew into half-float targets unconditionally. WebGL2 can only draw into RGBA16F with
  EXT_color_buffer_float or _half_float; without them the framebuffer is incomplete, every draw is dropped without a throw, and
  the screen pass copies transparent texels: exactly the friend's shot. Proven with the real three r186 + postprocessing 6.39.5
  in headless Chromium with the extensions hidden (canvas alpha 0; with the fallback, drawn). `hdrTargetType` falls back to
  8-bit. Not proven to be the friend's device (his GPU is unknown); the emulator's own black world turned out to be an
  emulator compositing fault (a bare WebGL clear showed nothing either).
- **Loud.** `DrawCheck` (render/drawCheck.ts) reads the world target's framebuffer status and a 3×3 grid of canvas alpha at loop
  frames 60 and 300, in the draw's own task. Incomplete: a fatal fault (Sentry + the error card, KEEP PLAYING stays). Transparent
  at both: an uncaught fault (Sentry + the chip). Each names the GPU (unmasked renderer) and its colour-buffer extensions and
  limits. A WebGL context lost in front of the player is now a Sentry report too, with the GPU; time still never reloads.
- **A GPU restart lands on the title (WILDSHARD-GAME-8H, QA row 13).** opus-androidemu's emulator session (not the
  friend) hit a GPU process restart; GpuRecovery reloaded with `?glreload` as designed, but an online build's
  title-first rule (`bootRoute.ts` `onlineTitleFirst`, QA row 16) treats any untapped level URL as a reopened tab, so the recovery reload landed on the title. `?glreload` now skips that rule
  like `skipintro` (play.ts strips it once read, so a reopened tab has none; ReloadPrompt already lists it as a title skipper).
  `test/navigation-arrival.test.ts` pins both the shard-page and the bare grid-page reload. A loss in the first 20 s of a phone
  boot still goes to the title on purpose (`fragileBoot`). WILDSHARD-GAME-8G (the page killed twice, no JS error) was the
  same emulator's crashes.
- WILDSHARD-GAME-2M's six setPointerCapture events came from a different player abroad, not the friend.
