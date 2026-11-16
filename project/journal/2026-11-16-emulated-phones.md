# Emulated phones on staging (TEST-COVERAGE row 46, XR-7 to XR-9)

> Written by: Claude (mini-phones), 2026-11-16

Nobody had ever run Chrome on Android against the real game, and the iPhone checks were all by hand (BUG-9 and BUG-10 were
found that way). `scripts/staging-phones-proof.mjs` now does it on hosted runners every night: Mobile Safari in an iOS
Simulator on `macos-15`, Chrome in a KVM Android emulator on Linux. Each goes title to play on staging.wildshard.io, walks
Driftwood on a real OS touch on the move stick (idb's HID touch, `adb shell input touchscreen`), then the two meet in one room,
each draws the other, and each says so in chat, which is the only channel the two jobs share.

It drives each browser over its own Inspector socket, as `online-phone-proof.mjs` does, so no Appium. The touch lands where the
page says it did: one calibration tap maps CSS pixels to the screen, whatever the browser's bars are. `.github/workflows/phones.yml`
reports, never gates; changing the proof re-runs it on that push.

First hosted runs (2026-11-16): Safari on an iPhone 17 Pro Simulator (iOS 26.2, Xcode 26.3, Apple GPU) went title to
play on staging and a real idb touch on the stick walked the body 10.5 m on the server (run 43881038858). Android does not
boot Chrome yet: the API 37 x86_64 emulator boots, but on swiftshader, angle and guest renderers alike its launcher ANRs
and Chrome never starts. So both legs run `--solo` and Android is `continue-on-error` until it does; XR-9 needs both.
