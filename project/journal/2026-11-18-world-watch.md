# 2026-11-18: the world watch after control (meta STAGING-BUGBASH SB48, P0)

- Jake's iPhone 17 Pro on staging v0.1.43 (12:07 Cancún, Low Power, Developer hold, return visit, 67 s load) showed the HUD
  over the page's own `#050810`: every pixel of the world region is the body background, so the world canvas was not on
  screen (hidden by a style, never presented, or presented transparent). A failed draw would have read opaque black, a
  lost context would have paused into the menu (GpuRecovery). Sentry has no staging event for it.
- Not reproduced headless: the exact v0.1.43 staging dist served on the staging origin in Chromium (Metal and
  SwiftShader, iPhone UA, so the WebKit-only pass split, byte triples and collection hint all run), phone Low, Developer
  hold, 6x CPU, `debug.passSplit=1000`; headless WebKit phone Low on staging before codex-ms repointed it to v0.1.42.
- `core/worldWatch.ts` therefore makes the next one diagnosable and not silent: looks at 3, 8, 20 and 45 s after control
  (a 48 px copy in the frame's task, `Game.captureFrame`); a canvas left hidden comes back and is reported once; a
  transparent or flat black world is reported (tier, graphics, pass split, drawing buffer, programs) and, still so at the
  next look, opens the error card's RELOAD. Never while hidden, held, lost, or under the grid reveal.
- The staging smoke now looks at the world too (brief step 3): `staging-smoke/worldFrame.mjs` judges the middle of a play
  frame (no golden image) and fails P0 `black-world` when the page background shows through a flat region or the region
  is a flat dark fill. Jake's frame: mean 8, sd 4.7, 99.9 % page background, flagged. New scenario K6 enters every
  Shard Select card a player can enter at phone Low on WebKit (Low Power's mode, which K1-K5 never reach) and judges each
  cell's frame 4 s into play. First run on staging v0.1.42: six cells, 129 s, all drawn (mean 65 to 133, sd 34 to 61).
- The Load step Jake read as "Worker boot" on his iPhone is renamed for what it does: "Joining the world" on a build with a
  world (staging, prod), "Starting the in-page server" only on a build with no world (the preview), one rule
  (`serverRoute.ts` `serverStepLabel`) for both the step row and its counted card.
