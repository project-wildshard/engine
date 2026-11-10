# Copy diagnostics in the iOS Simulator, and the lost counters

LS4 (J188) and LS1, opus-ls4, 2026-11-10.

**Simulator proof.** A local full-catalogue build (`6c91eb8-mwa4dlmr`) behind a
small proof server that seeds Jake's phone settings (Developer on, Hold at
loading screen) and, in fail mode, answers the real standalone server worker
with HTTP 503 and serves no service worker. XCUITest drove real native
touches on `wildshard-loading` (iOS 27.0). On iOS 26.5 (`wildshard-iphone`)
XCUITest could not attach to Safari ("has not loaded accessibility"), so the
taps ran on the 27.0 device. Every tap landed 4 pt inside the top edge of
Copy diagnostics, the hardest point of its hit area, and every copy read back
from the Simulator pasteboard with `simctl pbpaste`:

| Where | Boot | Copy at (pt, of 874) | Pasted |
|---|---|---|---|
| Safari | failed (`Driftwood Isle could not load`) | y 632-686 | 673 kB, marked failed, not ready |
| Safari | ready | y 585-638 | 1.66 MB |
| Home-screen web app (`com.apple.webapp`, Add to Home Screen through Safari's page menu) | failed | y 730-784 | 669 kB, marked failed |
| Home-screen web app | ready | y 643-696 | 514 kB |

Each paste has the build, tier, attempt, cache numbers, load rows and the full
LS1 timeline, with privacy `own-paths-other-urls-and-free-text-removed`. Every
Copy sits well below the status bar, in Safari and in the full-screen web app.
The web clip was removed afterwards.

**Lost counters.** A fresh-grid Copy carried 501 of 506 counters. LD3 names
this page's files by path and elides any segment over 96 characters; LD6's
longest content-named chunks in `/b/c/` pass that, so six `download:` counters
became one key, `download:/b/c/…`. The copy now never gives two files one name
(`<path>#2`) and never overwrites a counter. In the pastes above, 4 to 17
counters carry such a suffix.

**Two painters.** On a saved-Ember entry the download bar went 95, 95.4, 95:
entry.ts's early painter kept writing whole percents after Loading took the
same download. Loading's `setDownloadSource` now marks the card and the early
painter stops there. The takeover test uses a real Loading on a real shell card
and fails without the fix.

**WebKit card proof** (`loading-card-proof.mjs --grid --browser=webkit`, build
`239c1f6`): fresh grid, saved Ember and missing art each copy a complete safe
report, with 0 stalls, 0 backwards, 0 untraced and 0 faults. Before, the fresh
grid's copy failed and saved Ember showed 3 untraced changes (on LS5's build, 1
backwards too). The proof now also reports each entry's own faults: one list
used to span all three entries.

J206 Codex reviews: 1 MUST-FIX (the proof's per-entry faults missed PLAY, the
walk and Exit) and 2 SHOULD-FIXes (a counter name could still repeat; the
takeover test was hand-set), all fixed.

**LS1 in the Simulator.** `scripts/sim-grid-entry.mjs --startup-trace=1` on
`wildshard-iphone` (iOS 26.5), cold Infinite Wildshard on build `087b10f`:
first game step at 5.4 s, loader complete at 11.6 s, 1,875 entries, 302
resources, 478 counters, no overflow, largest unnamed gap 658 ms. The run's
later video check failed in ffmpeg after the trace was saved; that check is M1's,
not LS1's.
