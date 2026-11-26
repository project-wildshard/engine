# A page with a goto word quit before its hello (QA 11-25 row 85)

> Written by: Claude (opus-chunk3)

failmode's `full` case sometimes left a waiting page holding its ticket. Every page with a goto word holds its hello
until the door's first word (CP5's `gotoFirst`, up to 3 s), so a Title click inside that window sent the quit on a link
whose hello had not gone. The door never knew the seat, so `queue.leave` never ran. A page now sends its held hello
before it says the quit (`client.helloNow()`), and `leave()` clears the `sayFirst` hook. A new online-shell test makes
a goto page quit its held body and fails without the fix. With the fix, `full` passed 4 of 4 local runs, including one
that forced a 30 s retry before Title. The idea that the door's per-address connect limit refused the quit was tested
and did not hold. The doctor-worker proof (`scripts/e7-doctor-worker-proof.mjs`) had no callers and failed on a
retired shell path. The PWA and doctor unit tests cover what it covered, so it is retired.
