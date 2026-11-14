# Slow and Unstable chips (buddy-engine)

- MMO-FAILURE-MODES FM4b modes 21 and 22. The link already measured
  the pong RTT and the server's `lossPct` (the share of frames it says
  it skipped for this client); nothing told the player.
- `linkScreens` samples them once a second while the link is live
  (`stats` hook, the shell passes `NetClient.stats`). Slow: RTT over
  250 ms for 5 s in a row, the chip says the measured ms. Unstable: the
  last five RTTs span 250 ms or more, or `lossPct` is 5 % or more, for
  5 s; the chip says "others may jump" and claims no packet loss.
- A chip clears after 10 good seconds and shows at most once a minute.
  It is the bottom layer: down, the banner takes the band and the chip
  goes; it comes back only if still due after the link is live again.
- A fall from slow to fast is itself a spread, so slow clears about
  14 s after the RTT recovers, not 10.
- Test: `test/online-link-screens.test.ts` (fake timers: sustain,
  clear, the minute's gap, lossPct, spread without slow, down hides).
