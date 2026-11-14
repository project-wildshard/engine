# Welcome back card (buddy-engine)

- MMO-FAILURE-MODES FM4b modes 4 (`background-long`) and 45
  (`sleep-wake`). Found a real bug on the way: a phone back after 4
  minutes in the background to a dead socket opened straight on
  "Couldn't reconnect". `lose()` counts the give-up clock from the last
  frame, which was 4 minutes ago, so the first watch tick was past
  120 s and gave up without one dial.
- `Redial.woke` runs on every watch tick and on `check(hiddenMs)`. Away
  is either hidden time the shell measured (visibilitychange, now passed
  through `visible(hiddenMs)`) or a gap of 30 s in the watch's own
  100 ms tick (the page's clock ran, its timers didn't: a sleep, a
  frozen tab). Back to a quiet link: the give-up clock starts at the
  return; a link already dialling moves its clock on by the tick gap
  only (hidden time with ticks running was dialled through).
- `progress.away` carries `{ ms, how }` until the first frame back.
  `linkScreens` shows the card over play instead of the banner: how long
  the page measured itself away, the dial's tries, Try now and Check
  connection. J229: it claims no lost seat and no last-save resume.
- Healthy control: frames heard within a second of the return change
  nothing. On macOS Chrome `performance.now` may not run during sleep;
  then there is no gap to see, and the normal banner path is right.
- Tests: `test/net-redial.test.ts` (4 min hidden, asleep then hidden,
  healthy control, a dialling link's clock), `test/online-link-screens.test.ts`.
