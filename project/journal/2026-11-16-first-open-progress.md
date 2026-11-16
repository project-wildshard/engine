# A Home Screen launch hands over to the live shell at load (FIRST-OPEN-PROGRESS, buddy-engine)

- Jake, QA-FEEDBACK 2026-11-16 row 17: the first cold open of v0.1.29
  `a1adf711` from the Home Screen showed the WILDSHARD title and grid
  art for about 10 s with no pill, bar or SHARD SELECT, then the menu.
- No commit dropped the progress. The shell's bar, pill and file count
  (f4005411, QA 11-13) are still there and still move. PZ27 (dea4412c,
  bc25312e) only touched the Loading card's styles under the shell. What
  Jake saw was iOS's still launch image (`apple-touch-startup-image`,
  from generate-title-launch.mjs), which hides the pill and bar on
  purpose. iOS keeps that image up until the document's `load`, and
  every bundle tag delays `load`: the module graph and the 280 kB
  stylesheet. In Jake's video the live shell is on screen for one tenth
  of a second, then the menu.
- Measured on the unfixed build, headless WebKit 402x874 on a cold 1.6
  Mbps / 150 ms line: the shell paints at 1.99 s, `load` comes at 5.08
  s, and the menu at 5.08 s. On an iPhone that is still image the whole
  time.
- Fix, `lateBootTags` in buildIdentity.mjs (run by `stampBuildHtml`):
  the title document's module, modulepreload and stylesheet tags move
  into one inert `<template data-boot-late>`. In a browser tab they are
  written back in place with `document.write` while the page parses:
  parser-inserted and deferred, exactly as before. On a Home Screen
  launch (`navigator.standalone` or display-mode standalone) they are
  added after `load`. So `load` comes once the shell itself (fonts,
  first hero) has loaded, and iOS hands over to the moving bar and its
  file count.
- After, on the same line: standalone `load` at 1.92 s, before the first
  bundle request at 1.93 s; menu at 5.18 s (was 5.08 s). In a tab the
  menu is at 5.07 s, unchanged. Every frame from first paint to the menu
  shows moving progress in both. The iOS Simulator's Safari (tab) paints
  "Loading · 2 of 10 files · 2.3 s" and reaches the styled menu.
- Proof: `scripts/first-open-progress-proof.mjs [--standalone]` on a
  built `dist`. It runs a shaped server (`--serve` serves the same
  server to the Simulator), records every animation frame in the page,
  and saves a video, a screenshot every 250 ms and a contact sheet.
  Hashed files are served immutable as deployed. With `no-store`, WebKit
  fetched the stylesheet again on its print-to-all swap and showed an
  unstyled deck for a second and a half.
- Not proved: a real Home Screen launch. The Simulator cannot add one to
  the Home Screen without the UI, so this rests on the iOS behaviour
  Jake's video shows. Artifacts:
  `~/.cache/wildshard/plan-artifacts/first-open-progress/`.
