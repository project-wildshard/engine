# Failmodes: a boot screen after a slow load (QA 2026-11-19 row 8)

> Written by: Claude (opus-of-proofs)

- Hosted run 44485152362 saw no `release-429` screen, one release match. Not the game: a page reads its release file again
  only when it dials, after the world has loaded, and hosted SwiftShader takes past 30 s to get there. The harness gave the
  screen 30 s. Locally on SwiftShader the old harness failed the same way (still loading at 30.8 s); the new one saw the
  screen at 47.5 s and recovered.
- `bootScreenWait` (failmode-results.mjs) waits until the screen, until the page hears world frames without it (a real miss,
  at once), or 150 s, as `intoWorld` does.
