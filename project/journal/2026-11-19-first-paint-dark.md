# 2026-11-19: the first bytes are dark, and what the white really is

Lane: buddy-engine (Coordinator, QA-FEEDBACK 11-19 row 46).

Jake, staging v0.1.50 from the Home Screen on his iPhone 17 Pro: "The game flashes white on startup." His
recording: the launch still from 1.5 s to 10.45 s, then pure white for 14 s while the phone moved from
Wi-Fi to 4G, then the page with its boot footer at "STARTING 23.4 s".

Measured in the iOS 26 Simulator (iPhone 17 Pro, a real Home Screen web app, `simctl io recordVideo`,
brightness per frame) against a 3G server (750 kbit/s, 300 ms) that stalls the document for 20 s after
its first 40 kB, as the handover did. No service worker, as on a release the worker has not cached yet.
- Before: iOS keeps the launch still for about 8.5 s after the tap, then drops it, and the screen is white
  (luma 234) until the stall ends and the body arrives.
- The white is the page before WebKit paints anything. In the released document the first `<body>` byte
  is 65 kB in when gzipped, behind the 845 kB boot-module list (38 kB gzipped). Until the shell's markup
  arrives, WebKit has nothing it counts as content and does not paint, so the web view stays white.
- A dark style at the top of the head, `color-scheme: dark`, theme-color and the manifest colours do not
  change that. The run with all of them (this commit's build) is white for exactly as long as before.
- With the list moved below the shell, the shell arrives at 34 kB, inside the bytes before the stall, and
  paints at once. The run never goes white: "LOADING 4.0 s", then "STILL WAITING ON THE GAME CODE" with
  the bar moving.

This commit is the part the Coordinator scoped to me. opus-tr4b8 owns row 19, which cuts the list and the
worker's 6 s wait, and that is what takes the white away:
- The head opens with a first-paint block: charset (it was 863 kB in, past the 1024 bytes HTML allows),
  `color-scheme: dark` and `<style data-first-paint>` with the shell's #050810.
- `afterFirstPaint` (buildIdentity.mjs) makes the build stamp and the boot-module list go after that
  block, so it stays the first 123 bytes of the built page.
- theme-color and the manifest's background and theme colours are #050810 instead of the grey #34424f.
  iOS used that grey for the letter icon it draws when the icon fetch is slow.

Tests: first-paint-dark (4, all red on main). Proof:
`~/.cache/wildshard/plan-artifacts/qa-11-19-row46/` (board at 6, 12, 20 and 28 s for before, after and
list moved, three recordings, per-frame brightness).
