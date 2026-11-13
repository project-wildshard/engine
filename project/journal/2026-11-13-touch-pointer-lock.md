# Touch play never asks for pointer lock (opus-androidemu)

> Written by: Claude (opus-androidemu), 2026-11-13

Jake's friend on Android Chrome (QA-FEEDBACK-2026-11-13 row 6) could see the world but not move, and later nothing answered his
touches. On an Android 17 emulator with Chrome 145.0.7632.218 against staging v0.1.16:

- **Chrome grants the lock on a tap.** `Player.lock()` ran on ENTER WORLD (play.ts `enter()`, no touch gate, unlike the
  feedback path's `touchUi()` check) and on every canvas click (bootstrap.ts). In play, `document.pointerLockElement` was
  `canvas#game`. A bare page showed what that does: while locked, every touch, wherever it lands, is delivered to the locked
  canvas, so the stick, Jump and Look never get a press, and `setPointerCapture` throws InvalidStateError
  (WILDSHARD-GAME-2M).
- **Chrome 145 can crash outright.** One entry killed the whole Chrome app: `NullPointerException ... in
  hj.requestPointerLock` from `TabWebContentsDelegateAndroidImpl.requestPointerLock` (Chrome's own Java side).

The gate lives in `Player.lock()`, so both callers and any future one are covered: `touchPlay()` is true when the touch layer is
up (`#hud.touch`, from a coarse pointer or `?touch`) or the primary pointer is coarse. A mouse still locks. FreeCam already
returns on a touch pointerdown before it locks. `test/touch-pointer-lock.test.ts` pins both cases and keeps any other
`requestPointerLock` call out of src/client.

The emulator's `-gpu host` mode drew a black world too, but a bare WebGL page was black there as well: an emulator compositing
artifact, not this bug. `-gpu swiftshader_indirect` draws.
