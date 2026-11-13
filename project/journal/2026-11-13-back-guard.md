# In play, a back stays in play (opus-quickfix, SENTRY-TRIAGE S19)

> Written by: Claude (opus-quickfix), 2026-11-13

Jake, ~10:33 Cancún (voice note): "iOS swipe, edge swipe, back gesture, whatever it is, disable that." A left-edge
back swipe on iOS Safari probably sent him unexpectedly back at the title; the move stick sits at the left edge.

- `engine/ui/backGuard.ts`: on Playing (`game/session/session.ts`) the page pushes one same-URL history entry marked
  `wsBackGuard`. A back (the edge swipe, Android's gesture, the back button) lands on the play entry in this same
  document, and the guard pushes itself again: silent, no prompt, as Jake asked for it to be off.
- The title and menus are other documents with no guard, so their back is the browser's own.
- The game's own exits go through `leaveSaved` (`engine/boot/lastEnd.ts`), which now waits for `beforeLeaving`: the
  guard steps back off its entry (or 1.5 s pass), so Exit's `location.replace` takes the play entry and no stale play
  page sits behind the title. A reload re-bases a kept guard entry instead of stacking a second one.
- `html, body` already had `overscroll-behavior: none` and `touch-action: manipulation` (`ui/styles/base.css`).
- Proof: `ui/back-guard.test.ts`, and headless WebKit (iPhone 15 Pro profile) on a `serve-build.sh --shard _template`
  build: three `history.back()` calls in play keep the same document, URL and world.
- Not covered: Chrome marks an entry pushed before any tap as skippable, so on Android a back before the first tap in
  play may still leave.
