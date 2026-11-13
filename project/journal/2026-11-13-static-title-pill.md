# The static title says which build it is, reloads, and moves

> Written by: Claude (opus-splash), 2026-11-13

Jake, preview on his iPhone at 09:58: "I open preview, I see the static screen. ... Whenever I see this frozen screen
I'm like, is it broken? Is it doing something? Is it interactive? ... on the static screen can you show the version at
top right, and have that reload button top right work, at least?"

The static screen is `index.html`'s `.ws-launch` shell: the hero and WILDSHARD, painted before any bundle, removed by
`StartTitle` once the real deck mounts. It now also has:

- **The build pill, top right.** The same look as `update.css`'s `.ws-update`, copied inline (5 px higher, so it clears
  the wordmark at 402 px). Its words come from `globalThis.__WS_BUILD_LABEL__`, which `stampBuildHtml` now writes beside
  `__WS_BUILD_ID__`: the pill's own `git describe` label (`buildLabelOf` in `buildIdentity.mjs`, kept equal to
  `buildCheck.ts buildLabel` by a test). An older stamp falls back to the short commit, a dev page to "reload".
- **Reload that needs no bundle.** The pill is a plain `<button>` with `onclick` and `onpointerup` calling
  `location.reload()`. Proof: WebKit with every `/b/*` and `/assets/*` request aborted, one tap, a second document with
  navigation type `reload`.
- **A bar that moves.** A sweep runs from the first paint; the fill counts the code and style files the document names
  (module scripts, modulepreloads, stylesheets) from `__bootTiming` (LS1), 80% for files, then 10% at `app:entry-body`
  and 5% at `app:page-entry-import`. The line under it reads "Loading · 7 of 16 files · 1.4 s", "Starting", "Opening
  the menu", with the seconds ticking. Eight seconds with nothing new turns the line and the pill amber, and the pill
  says reload.

None of it is in the title's JS closure (the `js/title/gzip` ratchet counts chunks only); it is about 4 KB of HTML.
`generate-title-launch.mjs` hides the pill and bar, so iOS's still launch image keeps only the hero and wordmark.

Shot: `~/.cache/wildshard/plan-artifacts/qa/splash/static-title-402x874-webkit.png`.
