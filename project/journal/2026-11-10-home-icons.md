# Home-screen icons per environment (J236)

- Jake picked framing A (tilt) for the home-screen icons: a real engine
  render of the 3 × 3 around Driftwood. Production is plain, staging
  wears an amber S, preview a violet P (QA 22, meta repo).
- One build serves all three hosts, so the channel comes from the
  world stamp the page is built with: a `releases/production.json`
  world is production, any other world staging, no world (the solo
  build) preview. `scripts/app-build/homeIcons.mjs` rewrites the head
  links and the web manifest after `stampBuildDocuments`, before the
  service worker reads the document, and drops the other channels'
  folders from the output.
- Files live in `public/icons/<channel>/`: a 180 px opaque touch icon,
  a 64 px favicon, 192/512 `any` and 192/512 `maskable`. The maskable
  pair is the same composition re-framed smaller (FILL 0.76 instead of
  0.94) with the coin moved inside Android's 80 % safe circle; the
  corner coin of the iOS art would be cut off by a circle mask.
- `scripts/home-icons.mjs` makes them with sharp from the 1024 px
  masters. A dithered palette PNG is 39 dB from truecolour at a third
  of the bytes, so each deploy carries ~290 KB of icons, not ~930 KB.
- The masters are not committed (1 MB each). They rebuild exactly from
  the Codex lane's `compose.py` + `badges.mjs` (tilt pose, FILL 0.94,
  accents 8fe3ff / ffb547 / b18cff), which reproduce the approved PNGs
  to the byte.
- The root `/apple-touch-icon.png`, `/favicon.png`, `/icon-192.png`,
  `/icon-512.png` are gone; diagnostics treats `/icons/` as public.
