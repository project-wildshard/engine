# Low Power Mode on the loading card and in Copy diagnostics

> Written by: Claude

Jake, 2026-11-10, after a Nine load on his iPhone with Low Power on (QA row 27): "if you can detect between low power
mode and non-low power mode and just put it in your own diagnostics, it's fucking GG." Safari has no Low Power API, but
it caps requestAnimationFrame at 30 Hz there: the worker memory page read 30.0 frames/s with it on and 59.8 off.

`boot/lowPower.ts` counts this document's rAF callbacks for its first second, from the app entry. A boot's long tasks
only stretch frame intervals, never shorten them, so the verdict reads the short end: Low Power is likely when even the
25th-percentile interval is 25 ms or longer (40 Hz or less). A title page (no shard in the URL, an idle page) keeps its
reading for the tab in the session save `boot.lowPower`, and a later loading page shows that one for ten minutes before
its own. The card's tier line ends 'low power likely' or 'low power no' once a reading exists; Copy diagnostics' header
says `low power: likely (rAF 30.0/s on the title)`, or `unread`. Diagnostics only: nothing changes behaviour.

Tests in `loading-footer.test.ts`: 30 Hz is likely and 60 Hz is not, with and without long tasks between frames; too
few frames is no reading; the tier line repaints when the reading lands; a fresh title reading wins, a stale one does
not; a title page keeps its reading. Not read on a real phone yet: Jake's next Copy diagnostics paste is the proof.
