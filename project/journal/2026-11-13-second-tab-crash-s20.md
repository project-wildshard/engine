# A second tab no longer claims a crash (SENTRY-TRIAGE S20)

opus-iosmem found it: open a new tab while another tab plays and the
title says "The game restarted unexpectedly". The new tab has no
session copy of the alive beat, so `lastEnd` falls back to the device
copy (`life.alive.once`, kept because an iOS kill can lose session
storage), and that copy is the other tab's live beat.

Classification is synchronous, and a liveness check can't be. So the
beat now carries a page id, each shown page holds a Web Lock named
for it, and an end that rests on a beat with an id stays pending
until `settleLastEnd()` asks `navigator.locks.query()` (at most
500 ms). A held or pending lock means the page lives in another tab:
the end is `fresh`, and its beat is left alone. A killed page's lock
went with its process, so a real crash still reads `unexpected`.
The entry awaits the settle before any title reads `lastEnd()`; it
runs beside the stylesheet wait, so it costs nothing in practice.

The lock is let go at pagehide (a held lock would keep the page out
of the bfcache) and taken back on a bfcache return or when an iOS
page comes visible again. The review caught that last case, a
pending lock counting as dead, and a duplicated tab's copied session
beat; all three are fixed and tested. With no Web Locks (an old
Safari) the beat has no lock behind it and reads as before.
