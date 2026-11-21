# SB53 follow-up: one offline wait per failure screen

Lane mini-close (2026-11-21), main red run 44939642443.

- load-failure-copy's first test stubbed `navigator` without `onLine`, so its failure screen registered an `online`
  listener that outlived the test. The SB53 offline test fired it with its own, and the leftover reload landed in the
  "waits for the player" test.
- `showLoadFailure` now keeps one wait: a new screen disposes the old one's, and a wait whose screen is off the page does
  nothing. The tests stub `onLine` and drain leftover listeners and the 100 ms leave timer in `afterEach`.
