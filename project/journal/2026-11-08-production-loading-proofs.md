# Production loading and recovery boundaries

Manual timing/card tools can now target the real production origin only
when its exact build ID and epoch one match. They retain every existing
gap, bar, native clipboard and readiness assertion. Local serving remains
the default. GRID recovery now uses a trusted locator click rather than a
scheduled synthetic DOM click, and retains the native error's name.

Actual production d91507e-mw810im4 (engine v0.1.2/cfd6681) passes all four
strict Dunes/Template boots. Throttled Chromium and phone WebKit Dunes
finish in 21.3/5.3 seconds, Template in 11.6/4.1 seconds. Every run has zero
two-second stalls, backwards or untraced changes, real code/worker counts,
complete native safe clipboard readback and explicit copy refusal feedback.
Dunes timing reaches loader-complete in 10830/5801 ms with maximum unnamed
gaps 277/278 ms on Chromium/WebKit. These are phone profiles, not a physical
iPhone or Simulator reading.

SR4 remains red. Production WebKit reaches Ember, saves and returns within
0.11 mm, but reports native Context is stopped at the cold GRID tap. The
trusted-click comparison also reports it, named Cache API operation failed,
while restoring within 0.17 mm. It is not a synthetic-click-only failure.
Native promise observation never filters the exception. Actual process
kill/restart separately stalls after Final activation for 150 seconds;
there is no claimed runtime repair or closed recovery row.

The shell train is independently fail-closed. Hosted Chromium's Nalati
failure is QuotaExceededError in Spawn download/Final activation after
world and shader completion at about 25.9 seconds. Hosted WebKit reaches
Ember but rejects the first card's blank/default portrait before correct
metadata adoption. Both use unchanged pinned cfd6681. No timeout, graphics
backend, oracle, cache guarantee or epoch was relaxed.
