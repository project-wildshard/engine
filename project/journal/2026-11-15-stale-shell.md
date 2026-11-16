# The stale shell: a phone stuck on an old build's title (QA-FEEDBACK-2026-11-15 row 32)

> Written by: Claude (opus-staleshell)

Jake's iPhone on staging sat on v0.1.19-43's static title through every reload: "8 of 8 files", then "still waiting · tap
reload", while staging ran v0.1.23. His worker had installed v0.1.19's shell but never held its build's code (a title-only
visit never reaches control, DL1, and `/b/*` scripts are read past the worker's fetch handler), and still answered every
navigation with its baked document. That document named `/b/<build>/` code the next deploy took off the server, so the entry
module never ran. The v0.1.23 worker installed and waited behind it for good: a reload never activates a waiting worker, and
the old page's adopt flow lives in the bundle that never ran.

The fix (`src/client/engine/pwa/sw.js`): a worker answers a navigation with its own document only when it holds its whole
generation (its book); otherwise the network's page answers, and the baked one only offline or after 6 s. An update takes
over by itself: over a whole running build it first downloads its own generation inside its install (a cut download fails the
install, the old build stays whole), over a build that is not whole it takes over after its shell. The static shell's reload
(pill and 12 s self-reload) drops the worker and reloads the same URL. The player's reload keeps the URL (Jake 21:10:
"/slug/blender-template ... went to the homepage"). Proof: headless WebKit at 402x874 on a 400 kbit/s, 300 ms, 5% stall
profile, unfixed release stuck on all three loads, fixed release on the slug page in the first visit.

OF24, same day: a forced update (a server refuses this build at hello, `reloadRefusedBuild`) now puts one line up on the
RELOADING cover, "This version no longer fits the world · loading the update", then reloads once at the same URL
(`sayingReload` in `chunkRecovery.ts`); the session's one reload claim still stops any loop.
