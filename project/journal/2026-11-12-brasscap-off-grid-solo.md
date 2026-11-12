# Brasscap drops to the title (opus-brass3)

- Jake 2026-11-12 17:20 Cancun, phone: Blender Template (Brasscap, blender-template) loads to ~52% and drops to the main menu.
  Cause: a one-shard page on a build with a world (staging, play) joined the world, which opens only grid cells. The door's
  resume seated the device in driftwood-isle, the page went to ?chunk=driftwood-isle and from there to the title.
  Fix: serverRoute/earlyStandalone take `placed` (the page's grid catalogue places the shard); an off-grid one-shard page
  runs the in-page standalone server. test/server-route.test.ts guards it.
