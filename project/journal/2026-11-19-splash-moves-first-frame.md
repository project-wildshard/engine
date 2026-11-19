# 2026-11-19: the splash moves from its first frame

Lane: buddy-engine (Coordinator, QA-FEEDBACK 11-19 row 18).

Jake, a cold Home Screen open of v0.1.50: "There shouldn't be a frozen image. It should have some kind of
loading bar ... a spinner ... Something should move on this page." His recording holds a still WILDSHARD
picture for about 4.3 s, then shows the live shell for one frame ("STARTING · 4.3 s"), then the menu.

What the still is, measured in the iOS 26 Simulator with a real Home Screen web app (idb taps through
Share, Add to Home Screen; `xcrun simctl io recordVideo`; the build served on a shaped line):
- It is iOS's own launch screen: the `apple-touch-startup-image` PNG, which iOS fetches when the app is
  added. When that fetch does not finish in time, the launch screen is plain white instead. Nothing on
  it can move.
- iOS takes it down at the document's `load`, not at the first paint. Moving the 844 kB boot bank
  below the shell changed nothing. Compressed, the bank is about 11 kB of the page's 46 kB, so its size
  is not the wait either.
- A cached relaunch went straight from the still to the menu. The bundles were added in the load event
  itself, so their code held the frame iOS shows when the still goes.
- The still no longer matched the shell: it was rendered on 11-07, and the shell was reframed on 11-17
  (f0927ac4c). The live frame jumped from it.

Changes:
- A Home Screen launch adds the bundle tags after one painted frame of the shell (a frame, then the next
  one's start; 250 ms at most when frames are throttled). A browser tab is unchanged.
- The bar's sweep is a transform, so the compositor keeps it moving while code runs on the main thread.
  A negative delay starts it mid-bar, so the first frame shows it. Reduced motion pulses the bar's
  opacity instead of stopping it.
- The launch PNG is re-rendered from today's shell (aa16bc3256f3, 1.30 MB, was 1.64 MB), with its storage
  pin, the boot publication rows (edited by hand; nothing publishes them now) and the generated tables.

Proof, Simulator, cold launch of the built page: the still image lines up with the shell, then the shell
appears with its bar moving, then the menu. On a cached relaunch, the frame after the still is the shell,
showing "LOADING · 0.2 S" with the sweep mid-bar, then the menu (before: the menu). Headless WebKit on the
built page: the first frame's sweep is 121 px in and every frame differs; under reduced motion the
opacity differs every frame. Tests: late-boot-tags (2 new or changed) and launch-bar-motion (2), all 4
red on main.

Not changed: how long iOS shows the still. That is the time to `load` on the phone (the worker's start,
the page, three fonts and the 30 kB first hero). The Simulator shows 0.6 to 2.7 s depending on the line;
Jake's phone showed 4.3 s, and finding where that goes needs his phone's own boot timing.
