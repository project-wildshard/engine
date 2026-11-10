# LS5: time left that's honest

Jake wants the loading card to say how long it has left, and only with real numbers (J188, his call 3 of
2026-11-07: "only once enough real readings make it honest"). The card now has a time-left row under the tier,
whole seconds that count down with the clock, hidden until the readings support a number.

The estimate is `src/client/engine/boot/timeLeft.ts`. A single speed ratio over the bar's weights failed: between an
unthrottled desktop GPU and the phone stand-in (Chromium on the Mac's GPU at 4x CPU and 12.8 Mbit/s), Home region
slows 3.6x, gameplay 12x and the program links barely at all. So the grid path is now measured on both profiles
(`loadingPaths.ts`, three runs each of `scripts/loading-time-left-proof.mjs --dump`), and each finished row is a
reading of where this device sits between them. A least-squares fit gives that place; every row still to run costs its
desktop seconds plus that share of the difference. A running row past its cost raises the fit, so the number goes up
rather than holding a wrong one. Rows' own reported shares are not used: they report cheap units first or last.

The grid's bar now takes its shares from the phone profile's seconds, as the shardfile and native paths already did
(LS7), instead of an equal share a row, so the bar's pace follows where the time goes on a phone-like device.

Hidden: before a second of phone-profile work has finished, while the download is open, on a path measured on one
profile or none (shardfile, native, cells), and on a GPU the shaders step measured slow. That last one is headless
SwiftShader, which builds its pipelines on the CPU inside the first frame, 19-26 s against 1.1 s on the Mac's GPU;
no table describes it, so it is the named exception, as in LS8 (J204).
